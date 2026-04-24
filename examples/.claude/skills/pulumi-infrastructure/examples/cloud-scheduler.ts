/**
 * Cloud Scheduler — Managed cron jobs that call HTTP endpoints
 *
 * Key concepts:
 * - schedule: standard cron format (e.g., '*/5 * * * *' = every 5 minutes)
 * - httpTarget: calls an HTTP endpoint (e.g., Cloud Run internal route)
 * - headers: pass auth tokens (e.g., X-Scheduler-Secret)
 * - timeZone: affects when the cron fires (use your app's timezone)
 * - Requires Cloud Scheduler API to be enabled
 * - Cloud Run service URL is resolved dynamically via pulumi.interpolate
 */
import * as gcp from '@pulumi/gcp'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()
const schedulerSecret = config.requireSecret('schedulerSecret')

// Assume service URL comes from cloudrun module
declare const serviceUrl: pulumi.Output<string>

export const processScheduledPosts = new gcp.cloudscheduler.Job(
  'process-scheduled-posts',
  {
    name: 'process-scheduled-posts',
    region: 'europe-west1',
    schedule: '*/5 * * * *', // every 5 minutes
    timeZone: 'Europe/Paris',
    httpTarget: {
      uri: pulumi.interpolate`${serviceUrl}/internal/process-scheduled-posts`,
      httpMethod: 'POST',
      headers: {
        'X-Scheduler-Secret': schedulerSecret,
      },
    },
  }
)

export const dailyCleanup = new gcp.cloudscheduler.Job('daily-cleanup', {
  name: 'daily-cleanup',
  region: 'europe-west1',
  schedule: '0 3 * * *', // every day at 3am
  timeZone: 'Europe/Paris',
  httpTarget: {
    uri: pulumi.interpolate`${serviceUrl}/internal/daily-cleanup`,
    httpMethod: 'POST',
    headers: {
      'X-Scheduler-Secret': schedulerSecret,
    },
  },
})
