export const MAX_PROTOCOL_ATTEMPTS = 3;
export const PROTOCOL_RETRY_EXHAUSTED = "PROTOCOL_RETRY_EXHAUSTED";

export class ProtocolViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolViolationError";
  }
}

type Message = { content: string; role: string };

export async function completeWithProtocolRetries<T>(
  messages: Message[],
  complete: (messages: Message[]) => Promise<unknown>,
  validate: (rawResponse: unknown) => T,
  correctionInstruction: string,
): Promise<T> {
  const originalMessages = [...messages];

  for (let attempt = 1; attempt <= MAX_PROTOCOL_ATTEMPTS; attempt += 1) {
    try {
      return validate(await complete(messages));
    } catch (error) {
      if (!(error instanceof ProtocolViolationError)) throw error;

      if (attempt === MAX_PROTOCOL_ATTEMPTS) {
        throw new ProtocolViolationError(
          `${PROTOCOL_RETRY_EXHAUSTED}: Agent returned invalid information ${MAX_PROTOCOL_ATTEMPTS} times. Automatic retries stopped. Last violation: ${error.message}`,
        );
      }

      messages = [
        ...originalMessages,
        {
          role: "user",
          content: JSON.stringify({
            protocol_violation: error.message,
            failed_attempts: attempt,
            attempts_remaining: MAX_PROTOCOL_ATTEMPTS - attempt,
            required_fix: correctionInstruction,
          }),
        },
      ];
    }
  }

  throw new ProtocolViolationError(PROTOCOL_RETRY_EXHAUSTED);
}
