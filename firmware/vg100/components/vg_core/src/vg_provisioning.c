#include "vg_provisioning.h"

#include <stddef.h>

/** Doubles the backoff, saturating at the cap. */
static uint32_t next_backoff(uint32_t current) {
  if (current >= VG_PROV_BACKOFF_MAX_MS) {
    return VG_PROV_BACKOFF_MAX_MS;
  }
  uint32_t doubled = current * 2u;
  return doubled > VG_PROV_BACKOFF_MAX_MS ? VG_PROV_BACKOFF_MAX_MS : doubled;
}

/** Enters RETRY_WAIT, consuming the current backoff and advancing it. */
static void schedule_retry(vg_prov_ctx_t *ctx, vg_prov_outcome_t *outcome) {
  ctx->state = VG_PROV_STATE_RETRY_WAIT;
  outcome->actions |= VG_PROV_ACTION_ARM_RETRY_TIMER;
  outcome->retry_delay_ms = ctx->backoff_ms;
  ctx->backoff_ms = next_backoff(ctx->backoff_ms);
}

/**
 * Erase and restart.
 *
 * Used both by the reset control and by the stored-credential authentication
 * threshold. The destination state is recorded for the benefit of anything
 * that inspects the context, but the device is about to restart, so what
 * really matters is that the credentials are gone before it does.
 */
static void erase_and_reboot(vg_prov_ctx_t *ctx, vg_prov_outcome_t *outcome) {
  if (ctx->state == VG_PROV_STATE_CONNECTED) {
    outcome->actions |= VG_PROV_ACTION_SESSION_DOWN;
  }
  outcome->actions |= VG_PROV_ACTION_ERASE_CREDENTIALS | VG_PROV_ACTION_REBOOT;
  ctx->state = VG_PROV_STATE_PROVISIONING;
  ctx->has_credentials = false;
  ctx->in_provisioning_session = false;
  ctx->auth_failures = 0;
  ctx->backoff_ms = VG_PROV_BACKOFF_INITIAL_MS;
}

/**
 * A connection attempt failed while a provisioning session was open.
 *
 * The credentials came from a phone seconds ago and have never worked, so
 * they are discarded rather than kept. Keeping them would leave the device
 * retrying a typo forever, provisioned as far as the firmware is concerned,
 * and recoverable only with the reset button. Discarding them returns the
 * session to the state where the phone can simply send the right password.
 */
static void fail_during_session(vg_prov_ctx_t *ctx, vg_prov_outcome_t *outcome,
                                vg_prov_fail_reason_t reason) {
  outcome->actions |= VG_PROV_ACTION_DISCARD_CREDENTIALS;
  outcome->has_failure = true;
  outcome->failure = reason;
  ctx->state = VG_PROV_STATE_PROVISIONING;
  ctx->in_provisioning_session = false;
  ctx->backoff_ms = VG_PROV_BACKOFF_INITIAL_MS;
}

/**
 * A connection attempt failed using credentials that have worked before.
 *
 * Authentication failures are counted, because a run of them means the
 * network changed rather than that it is briefly unavailable. Everything
 * else is simply retried: a gateway should ride out a router reboot without
 * needing anyone's attention.
 */
static void fail_with_stored_credentials(vg_prov_ctx_t *ctx, vg_prov_outcome_t *outcome,
                                         vg_prov_fail_reason_t reason) {
  outcome->has_failure = true;
  outcome->failure = reason;

  if (reason == VG_PROV_FAIL_AUTH) {
    ctx->auth_failures++;
    if (ctx->auth_failures >= VG_PROV_REPROVISION_AFTER_AUTH_FAILURES) {
      erase_and_reboot(ctx, outcome);
      return;
    }
  }

  schedule_retry(ctx, outcome);
}

void vg_prov_init(vg_prov_ctx_t *ctx) {
  if (ctx == NULL) {
    return;
  }
  ctx->state = VG_PROV_STATE_BOOT;
  ctx->has_credentials = false;
  ctx->in_provisioning_session = false;
  ctx->auth_failures = 0;
  ctx->backoff_ms = VG_PROV_BACKOFF_INITIAL_MS;
}

vg_prov_outcome_t vg_prov_handle(vg_prov_ctx_t *ctx, const vg_prov_event_t *event) {
  vg_prov_outcome_t outcome = {0};

  if (ctx == NULL || event == NULL) {
    return outcome;
  }

  /* A reset means the same thing from every state, so it is answered before
   * the per-state handling rather than repeated inside it. */
  if (event->type == VG_PROV_EVENT_FACTORY_RESET) {
    erase_and_reboot(ctx, &outcome);
    return outcome;
  }

  switch (ctx->state) {
    case VG_PROV_STATE_BOOT:
      if (event->type != VG_PROV_EVENT_BOOT) {
        break;
      }

      if (event->credentials_stored && event->credentials_proven) {
        ctx->has_credentials = true;
        ctx->state = VG_PROV_STATE_CONNECTING;
        outcome.actions |= VG_PROV_ACTION_CONNECT_WIFI;
        break;
      }

      /*
       * Anything else is provisioning. The case that matters is credentials
       * stored without proof: ESP-IDF persists what a phone sends before
       * anything tries to use it, so a power loss between "received" and
       * "connected" leaves a password that may well be a typo, indexed by a
       * flag that says the device is provisioned. Booting into the reconnect
       * path on that would strand the gateway retrying forever, reachable
       * only by someone holding the reset button.
       *
       * Erasing rather than trusting costs a re-provisioning in the rare case
       * where the credentials were in fact good. That is a minute with a
       * phone, against a device nobody can recover without physical access.
       */
      ctx->has_credentials = false;
      ctx->state = VG_PROV_STATE_PROVISIONING;
      if (event->credentials_stored || event->credentials_proven) {
        outcome.actions |= VG_PROV_ACTION_ERASE_CREDENTIALS;
      }
      outcome.actions |= VG_PROV_ACTION_START_PROVISIONING;
      break;

    case VG_PROV_STATE_PROVISIONING:
      if (event->type != VG_PROV_EVENT_CREDENTIALS_RECEIVED) {
        break;
      }
      /* No CONNECT_WIFI here: the provisioning manager already has the
       * credentials and drives the attempt itself, including its own bounded
       * retries. Issuing a connect from here would race it.
       *
       * The marker is cleared before the attempt, not after it fails. By the
       * time this event arrives the credentials are already on flash, so the
       * only ordering that survives a power loss is to record "unproven"
       * first. */
      outcome.actions |= VG_PROV_ACTION_MARK_UNPROVEN;
      ctx->state = VG_PROV_STATE_CONNECTING;
      ctx->in_provisioning_session = true;
      break;

    case VG_PROV_STATE_CONNECTING:
      if (event->type == VG_PROV_EVENT_WIFI_CONNECTED) {
        if (ctx->in_provisioning_session) {
          outcome.actions |= VG_PROV_ACTION_COMMIT_CREDENTIALS | VG_PROV_ACTION_STOP_PROVISIONING;
          ctx->has_credentials = true;
          ctx->in_provisioning_session = false;
        }
        outcome.actions |= VG_PROV_ACTION_SESSION_UP;
        ctx->state = VG_PROV_STATE_CONNECTED;
        ctx->auth_failures = 0;
        ctx->backoff_ms = VG_PROV_BACKOFF_INITIAL_MS;
      } else if (event->type == VG_PROV_EVENT_WIFI_FAILED) {
        if (ctx->in_provisioning_session) {
          fail_during_session(ctx, &outcome, event->reason);
        } else {
          fail_with_stored_credentials(ctx, &outcome, event->reason);
        }
      }
      break;

    case VG_PROV_STATE_CONNECTED:
      if (event->type != VG_PROV_EVENT_WIFI_FAILED) {
        break;
      }
      outcome.actions |= VG_PROV_ACTION_SESSION_DOWN;
      fail_with_stored_credentials(ctx, &outcome, event->reason);
      break;

    case VG_PROV_STATE_RETRY_WAIT:
      if (event->type != VG_PROV_EVENT_RETRY_ELAPSED) {
        break;
      }
      ctx->state = VG_PROV_STATE_CONNECTING;
      outcome.actions |= VG_PROV_ACTION_CONNECT_WIFI;
      break;
  }

  return outcome;
}

const char *vg_prov_state_name(vg_prov_state_t state) {
  switch (state) {
    case VG_PROV_STATE_BOOT:
      return "boot";
    case VG_PROV_STATE_PROVISIONING:
      return "provisioning";
    case VG_PROV_STATE_CONNECTING:
      return "connecting";
    case VG_PROV_STATE_CONNECTED:
      return "connected";
    case VG_PROV_STATE_RETRY_WAIT:
      return "retry_wait";
  }
  return "unknown";
}

const char *vg_prov_fail_reason_name(vg_prov_fail_reason_t reason) {
  switch (reason) {
    case VG_PROV_FAIL_TRANSIENT:
      return "transient";
    case VG_PROV_FAIL_AUTH:
      return "auth";
    case VG_PROV_FAIL_AP_NOT_FOUND:
      return "ap_not_found";
  }
  return "unknown";
}
