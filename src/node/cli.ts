#!/usr/bin/env node
import { NoPayloadError } from "../core/analyze.js";
import { FlightParseError } from "../core/flight.js";
import { main } from "./main.js";
import { InputError } from "./sources.js";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const known = error instanceof InputError || error instanceof NoPayloadError || error instanceof FlightParseError;
    const isArgError = (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS");
    console.error(`rscope: ${(error as Error).message}`);
    if (!known && !isArgError) console.error((error as Error).stack);
    process.exitCode = 2;
  },
);
