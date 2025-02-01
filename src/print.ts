export function printErrorsAndWarnings(errors: string[], warnings: string[]) {
  if (errors.length > 0) {
    console.error(`${errors.length} Validation errors:`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error(
      `Registry contains errors that needs to be fixed before publishing\n`,
    );
  }

  if (warnings.length > 0) {
    console.warn(`${warnings.length} Validation warnings:`);
    for (const warning of warnings) {
      console.warn(`  - ${warning}`);
    }
    console.warn(`Registry contains warnings that ideally should be fixed\n`);
  }

  if (!errors && !warnings) {
    console.log("All networks are valid");
  }
}
