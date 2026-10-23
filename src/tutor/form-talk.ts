import { door } from "bsv-kit/bsv";
import { grist } from "bsv-kit/grist";
import { FORM_NAME_MAX, requestFields } from "voice-kit/forms";
import type { FormRequest, FormSpec, FormValue } from "voice-kit/forms";
import { FACTORY_COLLECTION } from "@/services/factory-service";

/** The grind the forms tutor runs: grinds/form-talk.json, version 1.0 of its input and answer. */
export const FORM_TALK_KIND = "form-talk";
export const FORM_TALK_VERSION = "1.0";

/** How many turns of the talk go back with each request. */
export const MAX_HISTORY_TURNS = 6;

/** One turn of the talk: what he said and what the tutor asked. */
export interface TalkTurn {
  q: string;
  a: string;
}

/** The app's input of the form-talk grind (schemas/form-talk-input-1.0). */
export interface FormTalkRequest {
  question: string;
  history: TalkTurn[];
  form: FormRequest;
}

/** The app's answer of the form-talk grind (schemas/form-talk-answer-1.0). */
export interface FormTalkAnswer {
  answer: string;
  form_values?: FormValue[];
  form_ask?: string;
}

/** Asks the tutor one turn. Rejects with a FormTalkError (or an AbortError when the signal aborts). */
export type FormTalkAsk = (request: FormTalkRequest, signal?: AbortSignal) => Promise<FormTalkAnswer>;

export class FormTalkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormTalkError";
  }
}

/**
 * The request for one turn: the form as the tutor sees it (its fields with what each holds now, and the
 * name of the command that sends it once the app shows Send), what he said, and the last turns.
 */
export function buildFormTalkRequest(
  form: FormSpec,
  values: Readonly<Record<string, string>>,
  question: string,
  history: readonly TalkTurn[],
  command?: string,
): FormTalkRequest {
  const request: FormRequest = {
    name: form.name.slice(0, FORM_NAME_MAX),
    fields: requestFields(form, values),
  };
  if (command) request.command = command;
  return { question, history: history.slice(-MAX_HISTORY_TURNS), form: request };
}

/** The tutor over the factory: each turn is a form-talk grist, and its answer is waited for (the mill answers in a poll or two). */
export function makeFormTalkAsk(backendUrl: string, key: Uint8Array): FormTalkAsk {
  const d = new door.Door({ baseUrl: backendUrl, key });
  return async (request, signal) => {
    const txid = await grist.sendGrist({
      door: d,
      key,
      app: FACTORY_COLLECTION,
      kind: FORM_TALK_KIND,
      v: FORM_TALK_VERSION,
      input: request,
    });
    const reply = await grist.awaitAnswer<FormTalkAnswer>(txid, { door: d, key, signal });
    if (reply.status !== "answered" || !reply.answer) {
      throw new FormTalkError(reply.reason || "The factory could not answer this one.");
    }
    return reply.answer;
  };
}
