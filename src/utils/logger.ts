/* eslint-disable no-console -- this IS the logger; console is the intended output */
import { env } from "../config/env";

type LogFields = Record<string, unknown>;

function emit(
  severity: "INFO" | "ERROR" | "WARNING",
  message: string,
  fields?: LogFields,
): void {
  if (env.LOG_FORMAT_JSON) {
    console.log(
      JSON.stringify({
        severity,
        message,
        time: new Date().toISOString(),
        ...fields,
      }),
    );
    return;
  }
  if (fields && Object.keys(fields).length > 0) {
    console.log(`[${severity}] ${message}`, fields);
  } else {
    console.log(`[${severity}] ${message}`);
  }
}

export const logger = {
  info(message: string, fields?: LogFields): void {
    emit("INFO", message, fields);
  },
  warn(message: string, fields?: LogFields): void {
    emit("WARNING", message, fields);
  },
  error(message: string, fields?: LogFields): void {
    emit("ERROR", message, fields);
  },
};
