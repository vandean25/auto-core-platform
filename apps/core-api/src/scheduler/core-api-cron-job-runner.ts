/** Contract for HTTP-triggered and in-process cron workers (AUT-715). */
export interface CoreApiCronJobRunner {
  run(): Promise<boolean>;
}
