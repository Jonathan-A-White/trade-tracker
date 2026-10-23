import { createContext, useContext } from "react";
import type { FormTalkAsk } from "./form-talk";

/**
 * How a form asks the tutor: the factory client when the door is licensed (FactoryProvider gives it),
 * a fake in a test, and null when there is no factory to ask (the form's door then says so).
 */
export const FormTutorContext = createContext<FormTalkAsk | null>(null);

export function useFormTutor(): FormTalkAsk | null {
  return useContext(FormTutorContext);
}
