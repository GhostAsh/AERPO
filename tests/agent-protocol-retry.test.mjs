import assert from "node:assert/strict";
import test from "node:test";
import {
  completeWithProtocolRetries,
  ProtocolViolationError,
} from "../src/lib/agent-protocol-retry.ts";

const messages = [
  { role: "system", content: "Follow the read-only ledger protocol." },
  { role: "user", content: '{"ledger_id":1042,"response_contract":{}}' },
];
const validate = (value) => {
  if (value !== "valid") throw new ProtocolViolationError("MISSING_ANSWER");
  return value;
};

for (const validAttempt of [1, 2, 3]) {
  test(`returns a valid response on attempt ${validAttempt} and stops`, async () => {
    const calls = [];
    const result = await completeWithProtocolRetries(
      messages,
      async (prompt) => {
        calls.push(prompt);
        return calls.length === validAttempt ? "valid" : "invalid";
      },
      validate,
      "Include the required answer and follow the original protocol.",
    );
    assert.equal(result, "valid");
    assert.equal(calls.length, validAttempt);
    for (let index = 1; index < calls.length; index++) {
      assert.deepEqual(calls[index].slice(0, 2), messages);
      const correction = JSON.parse(calls[index].at(-1).content);
      assert.equal(correction.protocol_violation, "MISSING_ANSWER");
      assert.equal(correction.failed_attempts, index);
      assert.equal(correction.attempts_remaining, 3 - index);
      assert.match(correction.required_fix, /required answer/);
    }
    assert.equal(messages.length, 2);
  });
}

test("JSON and validation failures share the same three-attempt budget", async () => {
  let calls = 0;
  await assert.rejects(
    completeWithProtocolRetries(messages, async () => {
      calls++;
      if (calls === 1) throw new ProtocolViolationError("INVALID_JSON");
      return "invalid";
    }, validate, "Follow the protocol."),
    { name: "ProtocolViolationError", message: /PROTOCOL_RETRY_EXHAUSTED:.*3 times.*Last violation: MISSING_ANSWER/ },
  );
  assert.equal(calls, 3);
});

test("API failures stop immediately", async () => {
  let calls = 0;
  const failure = new Error("API unavailable");
  await assert.rejects(
    completeWithProtocolRetries(messages, async () => {
      calls++;
      throw failure;
    }, validate, "Follow the protocol."),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
});
