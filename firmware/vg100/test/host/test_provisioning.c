/* Host tests for the VG-007 provisioning state machine. */
#include "vg_provisioning.h"

#include "vg_test.h"

/* --- helpers ------------------------------------------------------------ */

static vg_prov_outcome_t boot(vg_prov_ctx_t *ctx, bool has_credentials) {
  vg_prov_event_t event = {.type = VG_PROV_EVENT_BOOT, .has_credentials = has_credentials};
  return vg_prov_handle(ctx, &event);
}

static vg_prov_outcome_t send(vg_prov_ctx_t *ctx, vg_prov_event_type_t type) {
  vg_prov_event_t event = {.type = type};
  return vg_prov_handle(ctx, &event);
}

static vg_prov_outcome_t fail(vg_prov_ctx_t *ctx, vg_prov_fail_reason_t reason) {
  vg_prov_event_t event = {.type = VG_PROV_EVENT_WIFI_FAILED, .reason = reason};
  return vg_prov_handle(ctx, &event);
}

/** Drives a fresh context to CONNECTED over a provisioning session. */
static void provision_successfully(vg_prov_ctx_t *ctx) {
  vg_prov_init(ctx);
  boot(ctx, false);
  send(ctx, VG_PROV_EVENT_CREDENTIALS_RECEIVED);
  send(ctx, VG_PROV_EVENT_WIFI_CONNECTED);
}

/** Drives a fresh context to CONNECTED using already-stored credentials. */
static void connect_with_stored_credentials(vg_prov_ctx_t *ctx) {
  vg_prov_init(ctx);
  boot(ctx, true);
  send(ctx, VG_PROV_EVENT_WIFI_CONNECTED);
}

static bool has_action(vg_prov_outcome_t outcome, vg_prov_action_t action) {
  return (outcome.actions & (uint32_t)action) != 0u;
}

/* --- boot --------------------------------------------------------------- */

static void factory_fresh_device_advertises(void) {
  vg_prov_ctx_t ctx;
  vg_prov_init(&ctx);

  VG_CHECK_INT(ctx.state, VG_PROV_STATE_BOOT);

  vg_prov_outcome_t outcome = boot(&ctx, false);

  VG_CHECK_INT(ctx.state, VG_PROV_STATE_PROVISIONING);
  VG_CHECK_INT(outcome.actions, VG_PROV_ACTION_START_PROVISIONING);
  VG_CHECK(!ctx.has_credentials);
}

static void provisioned_device_connects_without_advertising(void) {
  vg_prov_ctx_t ctx;
  vg_prov_init(&ctx);

  vg_prov_outcome_t outcome = boot(&ctx, true);

  VG_CHECK_INT(ctx.state, VG_PROV_STATE_CONNECTING);
  VG_CHECK_INT(outcome.actions, VG_PROV_ACTION_CONNECT_WIFI);
  VG_CHECK(ctx.has_credentials);
  VG_CHECK(!has_action(outcome, VG_PROV_ACTION_START_PROVISIONING));
}

/* --- provisioning session ----------------------------------------------- */

static void received_credentials_leave_the_attempt_to_the_manager(void) {
  vg_prov_ctx_t ctx;
  vg_prov_init(&ctx);
  boot(&ctx, false);

  vg_prov_outcome_t outcome = send(&ctx, VG_PROV_EVENT_CREDENTIALS_RECEIVED);

  VG_CHECK_INT(ctx.state, VG_PROV_STATE_CONNECTING);
  VG_CHECK(ctx.in_provisioning_session);
  /* The provisioning manager already holds the credentials and is driving
   * the attempt; a connect from here would race it. */
  VG_CHECK_INT(outcome.actions, VG_PROV_ACTION_NONE);
}

static void proven_credentials_are_committed(void) {
  vg_prov_ctx_t ctx;
  vg_prov_init(&ctx);
  boot(&ctx, false);
  send(&ctx, VG_PROV_EVENT_CREDENTIALS_RECEIVED);

  vg_prov_outcome_t outcome = send(&ctx, VG_PROV_EVENT_WIFI_CONNECTED);

  VG_CHECK_INT(ctx.state, VG_PROV_STATE_CONNECTED);
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_COMMIT_CREDENTIALS));
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_STOP_PROVISIONING));
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_SESSION_UP));
  VG_CHECK(ctx.has_credentials);
  VG_CHECK(!ctx.in_provisioning_session);
}

/**
 * The case this whole design exists for: a mistyped password must not be
 * kept. If it were, the device would be "provisioned" with credentials that
 * can never work, and only the reset button would get it back.
 */
static void unproven_credentials_are_discarded(void) {
  const vg_prov_fail_reason_t reasons[] = {VG_PROV_FAIL_AUTH, VG_PROV_FAIL_AP_NOT_FOUND,
                                           VG_PROV_FAIL_TRANSIENT};

  for (size_t i = 0; i < sizeof(reasons) / sizeof(reasons[0]); i++) {
    vg_prov_ctx_t ctx;
    vg_prov_init(&ctx);
    boot(&ctx, false);
    send(&ctx, VG_PROV_EVENT_CREDENTIALS_RECEIVED);

    vg_prov_outcome_t outcome = fail(&ctx, reasons[i]);

    VG_CHECK_INT(ctx.state, VG_PROV_STATE_PROVISIONING);
    VG_CHECK(has_action(outcome, VG_PROV_ACTION_DISCARD_CREDENTIALS));
    VG_CHECK(!has_action(outcome, VG_PROV_ACTION_ERASE_CREDENTIALS));
    VG_CHECK(!has_action(outcome, VG_PROV_ACTION_ARM_RETRY_TIMER));
    VG_CHECK(!has_action(outcome, VG_PROV_ACTION_REBOOT));
    VG_CHECK(!ctx.has_credentials);
    VG_CHECK(!ctx.in_provisioning_session);
    VG_CHECK(outcome.has_failure);
    VG_CHECK_INT(outcome.failure, reasons[i]);
  }
}

static void a_second_attempt_can_follow_a_discarded_one(void) {
  vg_prov_ctx_t ctx;
  vg_prov_init(&ctx);
  boot(&ctx, false);
  send(&ctx, VG_PROV_EVENT_CREDENTIALS_RECEIVED);
  fail(&ctx, VG_PROV_FAIL_AUTH);

  send(&ctx, VG_PROV_EVENT_CREDENTIALS_RECEIVED);
  vg_prov_outcome_t outcome = send(&ctx, VG_PROV_EVENT_WIFI_CONNECTED);

  VG_CHECK_INT(ctx.state, VG_PROV_STATE_CONNECTED);
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_COMMIT_CREDENTIALS));
  VG_CHECK(ctx.has_credentials);
}

/* --- reconnection ------------------------------------------------------- */

static void connecting_with_stored_credentials_does_not_commit(void) {
  vg_prov_ctx_t ctx;
  vg_prov_init(&ctx);
  boot(&ctx, true);

  vg_prov_outcome_t outcome = send(&ctx, VG_PROV_EVENT_WIFI_CONNECTED);

  VG_CHECK_INT(ctx.state, VG_PROV_STATE_CONNECTED);
  VG_CHECK_INT(outcome.actions, VG_PROV_ACTION_SESSION_UP);
}

static void a_dropped_connection_tears_down_the_session_and_retries(void) {
  vg_prov_ctx_t ctx;
  connect_with_stored_credentials(&ctx);

  vg_prov_outcome_t outcome = fail(&ctx, VG_PROV_FAIL_TRANSIENT);

  VG_CHECK_INT(ctx.state, VG_PROV_STATE_RETRY_WAIT);
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_SESSION_DOWN));
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_ARM_RETRY_TIMER));
  VG_CHECK_INT(outcome.retry_delay_ms, VG_PROV_BACKOFF_INITIAL_MS);
}

static void the_retry_timer_drives_the_next_attempt(void) {
  vg_prov_ctx_t ctx;
  connect_with_stored_credentials(&ctx);
  fail(&ctx, VG_PROV_FAIL_TRANSIENT);

  vg_prov_outcome_t outcome = send(&ctx, VG_PROV_EVENT_RETRY_ELAPSED);

  VG_CHECK_INT(ctx.state, VG_PROV_STATE_CONNECTING);
  VG_CHECK_INT(outcome.actions, VG_PROV_ACTION_CONNECT_WIFI);
}

static void backoff_doubles_and_stops_at_the_cap(void) {
  const uint32_t expected[] = {1000u, 2000u, 4000u, 8000u, 16000u, 32000u, 60000u, 60000u, 60000u};

  vg_prov_ctx_t ctx;
  connect_with_stored_credentials(&ctx);

  for (size_t i = 0; i < sizeof(expected) / sizeof(expected[0]); i++) {
    vg_prov_outcome_t outcome = fail(&ctx, VG_PROV_FAIL_TRANSIENT);
    VG_CHECK(has_action(outcome, VG_PROV_ACTION_ARM_RETRY_TIMER));
    VG_CHECK_INT(outcome.retry_delay_ms, expected[i]);
    send(&ctx, VG_PROV_EVENT_RETRY_ELAPSED);
  }

  /* A router that is switched off is never a reason to stop trying. */
  VG_CHECK_INT(ctx.state, VG_PROV_STATE_CONNECTING);
  VG_CHECK(ctx.has_credentials);
}

static void a_successful_connection_resets_the_backoff(void) {
  vg_prov_ctx_t ctx;
  connect_with_stored_credentials(&ctx);

  fail(&ctx, VG_PROV_FAIL_TRANSIENT);
  send(&ctx, VG_PROV_EVENT_RETRY_ELAPSED);
  fail(&ctx, VG_PROV_FAIL_TRANSIENT);
  send(&ctx, VG_PROV_EVENT_RETRY_ELAPSED);
  send(&ctx, VG_PROV_EVENT_WIFI_CONNECTED);

  vg_prov_outcome_t outcome = fail(&ctx, VG_PROV_FAIL_TRANSIENT);

  VG_CHECK_INT(outcome.retry_delay_ms, VG_PROV_BACKOFF_INITIAL_MS);
}

/* --- authentication failures on stored credentials ---------------------- */

static void authentication_failures_below_the_threshold_only_retry(void) {
  vg_prov_ctx_t ctx;
  connect_with_stored_credentials(&ctx);

  for (uint32_t i = 1; i < VG_PROV_REPROVISION_AFTER_AUTH_FAILURES; i++) {
    vg_prov_outcome_t outcome = fail(&ctx, VG_PROV_FAIL_AUTH);
    VG_CHECK(has_action(outcome, VG_PROV_ACTION_ARM_RETRY_TIMER));
    VG_CHECK(!has_action(outcome, VG_PROV_ACTION_ERASE_CREDENTIALS));
    VG_CHECK(!has_action(outcome, VG_PROV_ACTION_REBOOT));
    VG_CHECK_INT(ctx.auth_failures, i);
    send(&ctx, VG_PROV_EVENT_RETRY_ELAPSED);
  }
}

/**
 * A changed Wi-Fi password must be recoverable from the app. Without this,
 * a gateway mounted in a ceiling needs a ladder.
 */
static void repeated_authentication_failures_reopen_provisioning(void) {
  vg_prov_ctx_t ctx;
  connect_with_stored_credentials(&ctx);

  vg_prov_outcome_t outcome = {0};
  for (uint32_t i = 0; i < VG_PROV_REPROVISION_AFTER_AUTH_FAILURES; i++) {
    outcome = fail(&ctx, VG_PROV_FAIL_AUTH);
    if (i + 1 < VG_PROV_REPROVISION_AFTER_AUTH_FAILURES) {
      send(&ctx, VG_PROV_EVENT_RETRY_ELAPSED);
    }
  }

  VG_CHECK(has_action(outcome, VG_PROV_ACTION_ERASE_CREDENTIALS));
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_REBOOT));
  VG_CHECK(!has_action(outcome, VG_PROV_ACTION_ARM_RETRY_TIMER));
  VG_CHECK_INT(ctx.state, VG_PROV_STATE_PROVISIONING);
  VG_CHECK(!ctx.has_credentials);
  VG_CHECK_INT(ctx.auth_failures, 0);
}

static void transient_failures_never_reach_the_threshold(void) {
  vg_prov_ctx_t ctx;
  connect_with_stored_credentials(&ctx);

  for (uint32_t i = 0; i < VG_PROV_REPROVISION_AFTER_AUTH_FAILURES * 3u; i++) {
    vg_prov_outcome_t outcome = fail(&ctx, VG_PROV_FAIL_TRANSIENT);
    VG_CHECK(!has_action(outcome, VG_PROV_ACTION_ERASE_CREDENTIALS));
    send(&ctx, VG_PROV_EVENT_RETRY_ELAPSED);
  }

  VG_CHECK_INT(ctx.auth_failures, 0);
  VG_CHECK(ctx.has_credentials);
}

static void a_successful_connection_forgives_earlier_authentication_failures(void) {
  vg_prov_ctx_t ctx;
  connect_with_stored_credentials(&ctx);

  for (uint32_t i = 0; i + 1 < VG_PROV_REPROVISION_AFTER_AUTH_FAILURES; i++) {
    fail(&ctx, VG_PROV_FAIL_AUTH);
    send(&ctx, VG_PROV_EVENT_RETRY_ELAPSED);
  }
  send(&ctx, VG_PROV_EVENT_WIFI_CONNECTED);

  VG_CHECK_INT(ctx.auth_failures, 0);

  vg_prov_outcome_t outcome = fail(&ctx, VG_PROV_FAIL_AUTH);
  VG_CHECK(!has_action(outcome, VG_PROV_ACTION_ERASE_CREDENTIALS));
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_ARM_RETRY_TIMER));
}

/* --- factory reset ------------------------------------------------------ */

static void factory_reset_works_from_every_state(void) {
  vg_prov_ctx_t ctx;

  /* PROVISIONING */
  vg_prov_init(&ctx);
  boot(&ctx, false);
  vg_prov_outcome_t outcome = send(&ctx, VG_PROV_EVENT_FACTORY_RESET);
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_ERASE_CREDENTIALS));
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_REBOOT));

  /* CONNECTING */
  vg_prov_init(&ctx);
  boot(&ctx, true);
  outcome = send(&ctx, VG_PROV_EVENT_FACTORY_RESET);
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_ERASE_CREDENTIALS));
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_REBOOT));
  VG_CHECK(!ctx.has_credentials);

  /* RETRY_WAIT */
  connect_with_stored_credentials(&ctx);
  fail(&ctx, VG_PROV_FAIL_TRANSIENT);
  VG_CHECK_INT(ctx.state, VG_PROV_STATE_RETRY_WAIT);
  outcome = send(&ctx, VG_PROV_EVENT_FACTORY_RESET);
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_ERASE_CREDENTIALS));
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_REBOOT));

  /* BOOT, before anything has been reported. */
  vg_prov_init(&ctx);
  outcome = send(&ctx, VG_PROV_EVENT_FACTORY_RESET);
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_ERASE_CREDENTIALS));
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_REBOOT));
}

static void factory_reset_while_connected_tears_the_session_down_first(void) {
  vg_prov_ctx_t ctx;
  provision_successfully(&ctx);

  vg_prov_outcome_t outcome = send(&ctx, VG_PROV_EVENT_FACTORY_RESET);

  VG_CHECK(has_action(outcome, VG_PROV_ACTION_SESSION_DOWN));
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_ERASE_CREDENTIALS));
  VG_CHECK(has_action(outcome, VG_PROV_ACTION_REBOOT));
  VG_CHECK_INT(ctx.state, VG_PROV_STATE_PROVISIONING);
  VG_CHECK(!ctx.has_credentials);
}

static void factory_reset_during_a_provisioning_session_discards_everything(void) {
  vg_prov_ctx_t ctx;
  vg_prov_init(&ctx);
  boot(&ctx, false);
  send(&ctx, VG_PROV_EVENT_CREDENTIALS_RECEIVED);

  vg_prov_outcome_t outcome = send(&ctx, VG_PROV_EVENT_FACTORY_RESET);

  VG_CHECK(has_action(outcome, VG_PROV_ACTION_ERASE_CREDENTIALS));
  VG_CHECK(!ctx.in_provisioning_session);
}

/* --- robustness --------------------------------------------------------- */

/*
 * Device events are asynchronous. A disconnect notification queued before a
 * reset was decided still arrives after it, and must not move the state
 * machine anywhere.
 */
static void events_that_mean_nothing_here_are_ignored(void) {
  vg_prov_ctx_t ctx;

  vg_prov_init(&ctx);
  vg_prov_outcome_t outcome = send(&ctx, VG_PROV_EVENT_WIFI_CONNECTED);
  VG_CHECK_INT(ctx.state, VG_PROV_STATE_BOOT);
  VG_CHECK_INT(outcome.actions, VG_PROV_ACTION_NONE);

  boot(&ctx, false);
  outcome = send(&ctx, VG_PROV_EVENT_RETRY_ELAPSED);
  VG_CHECK_INT(ctx.state, VG_PROV_STATE_PROVISIONING);
  VG_CHECK_INT(outcome.actions, VG_PROV_ACTION_NONE);

  outcome = fail(&ctx, VG_PROV_FAIL_TRANSIENT);
  VG_CHECK_INT(ctx.state, VG_PROV_STATE_PROVISIONING);
  VG_CHECK_INT(outcome.actions, VG_PROV_ACTION_NONE);

  connect_with_stored_credentials(&ctx);
  outcome = send(&ctx, VG_PROV_EVENT_CREDENTIALS_RECEIVED);
  VG_CHECK_INT(ctx.state, VG_PROV_STATE_CONNECTED);
  VG_CHECK_INT(outcome.actions, VG_PROV_ACTION_NONE);

  outcome = boot(&ctx, false);
  VG_CHECK_INT(ctx.state, VG_PROV_STATE_CONNECTED);
  VG_CHECK_INT(outcome.actions, VG_PROV_ACTION_NONE);
}

static void null_arguments_are_survivable(void) {
  vg_prov_event_t event = {.type = VG_PROV_EVENT_BOOT};
  vg_prov_ctx_t ctx;
  vg_prov_init(&ctx);

  vg_prov_init(NULL);
  VG_CHECK_INT(vg_prov_handle(NULL, &event).actions, VG_PROV_ACTION_NONE);
  VG_CHECK_INT(vg_prov_handle(&ctx, NULL).actions, VG_PROV_ACTION_NONE);
  VG_CHECK_INT(ctx.state, VG_PROV_STATE_BOOT);
}

static void every_state_and_reason_has_a_log_name(void) {
  const vg_prov_state_t states[] = {VG_PROV_STATE_BOOT, VG_PROV_STATE_PROVISIONING,
                                    VG_PROV_STATE_CONNECTING, VG_PROV_STATE_CONNECTED,
                                    VG_PROV_STATE_RETRY_WAIT};
  const vg_prov_fail_reason_t reasons[] = {VG_PROV_FAIL_TRANSIENT, VG_PROV_FAIL_AUTH,
                                           VG_PROV_FAIL_AP_NOT_FOUND};

  for (size_t i = 0; i < sizeof(states) / sizeof(states[0]); i++) {
    VG_CHECK(strcmp(vg_prov_state_name(states[i]), "unknown") != 0);
  }
  for (size_t i = 0; i < sizeof(reasons) / sizeof(reasons[0]); i++) {
    VG_CHECK(strcmp(vg_prov_fail_reason_name(reasons[i]), "unknown") != 0);
  }
}

int main(void) {
  VG_RUN(factory_fresh_device_advertises);
  VG_RUN(provisioned_device_connects_without_advertising);
  VG_RUN(received_credentials_leave_the_attempt_to_the_manager);
  VG_RUN(proven_credentials_are_committed);
  VG_RUN(unproven_credentials_are_discarded);
  VG_RUN(a_second_attempt_can_follow_a_discarded_one);
  VG_RUN(connecting_with_stored_credentials_does_not_commit);
  VG_RUN(a_dropped_connection_tears_down_the_session_and_retries);
  VG_RUN(the_retry_timer_drives_the_next_attempt);
  VG_RUN(backoff_doubles_and_stops_at_the_cap);
  VG_RUN(a_successful_connection_resets_the_backoff);
  VG_RUN(authentication_failures_below_the_threshold_only_retry);
  VG_RUN(repeated_authentication_failures_reopen_provisioning);
  VG_RUN(transient_failures_never_reach_the_threshold);
  VG_RUN(a_successful_connection_forgives_earlier_authentication_failures);
  VG_RUN(factory_reset_works_from_every_state);
  VG_RUN(factory_reset_while_connected_tears_the_session_down_first);
  VG_RUN(factory_reset_during_a_provisioning_session_discards_everything);
  VG_RUN(events_that_mean_nothing_here_are_ignored);
  VG_RUN(null_arguments_are_survivable);
  VG_RUN(every_state_and_reason_has_a_log_name);

  VG_TEST_MAIN_END("provisioning");
}
