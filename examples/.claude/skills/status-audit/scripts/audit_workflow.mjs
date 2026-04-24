#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const logsDir = path.resolve(process.cwd(), '.claude/logs')
const statusPath = path.join(logsDir, 'agent-status.json')
const eventsPath = path.join(logsDir, 'agent-events.jsonl')
const filter = process.argv.slice(2).join(' ').trim().toLowerCase()
const staleMinutes = Number(process.env.WORKFLOW_STALE_MINUTES || '15')

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function readEvents(filePath) {
  try {
    return fs
      .readFileSync(filePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function ageMinutes(iso) {
  if (!iso) return Number.POSITIVE_INFINITY
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.round(ms / 60000))
}

function gateType(entry) {
  if (entry.review_verdict) return 'review'
  if (entry.qa_verdict) return 'qa'
  return 'workflow'
}

function gateVerdict(entry) {
  return entry.review_verdict || entry.qa_verdict || 'n/a'
}

function gateDetails(entry) {
  if (entry.review_verdict) {
    return `C:${entry.critical_count || 0} H:${entry.high_count || 0} M:${entry.medium_count || 0} L:${entry.low_count || 0}`
  }

  if (entry.qa_verdict) {
    return `bugs:${entry.bugs_found || 0} pass:${entry.total_pass_count || 0} fail:${entry.total_fail_count || 0}`
  }

  return 'n/a'
}

function matchesFilter(entry) {
  if (!filter || filter === 'latest') return true
  const haystack = [
    entry.agent,
    entry.feature_spec,
    entry.state,
    entry.handoff_target,
    entry.summary,
    entry.review_verdict,
    entry.qa_verdict,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes(filter)
}

function health(entry) {
  const age = ageMinutes(entry.last_update)

  if (entry.review_verdict === 'fail' || entry.qa_verdict === 'fail') {
    return 'urgent'
  }

  if (entry.qa_verdict === 'blocked') {
    return 'urgent'
  }

  if (entry.state === 'blocked' || entry.state === 'failed') {
    return 'urgent'
  }

  if (
    ['in_progress', 'awaiting_review', 'awaiting_qa'].includes(entry.state) &&
    age >= staleMinutes
  ) {
    return 'stale'
  }

  if (entry.state === 'done' && entry.done_criteria_met === 'no') {
    return 'invalid'
  }

  return 'ok'
}

function nextAction(entries) {
  const reviewFailure = entries.find((entry) => entry.review_verdict === 'fail')
  if (reviewFailure) {
    return reviewFailure.review_recommendation || `Address review findings from ${reviewFailure.agent}`
  }

  const qaFailure = entries.find((entry) => entry.qa_verdict === 'fail')
  if (qaFailure) {
    return qaFailure.qa_recommendation || `Fix QA issues reported by ${qaFailure.agent}`
  }

  const urgent = entries.find((entry) => health(entry) === 'urgent')
  if (urgent) {
    return `Resolve blocker for ${urgent.agent}${urgent.blockers ? `: ${urgent.blockers}` : ''}`
  }

  const stale = entries.find((entry) => health(entry) === 'stale')
  if (stale) {
    return `Check whether ${stale.agent} is still progressing or needs intervention`
  }

  const pendingHandoff = entries.find(
    (entry) =>
      ['awaiting_review', 'awaiting_qa', 'awaiting_user'].includes(entry.state) &&
      (!entry.handoff_target || entry.handoff_target === 'none')
  )
  if (pendingHandoff) {
    return `Add an explicit handoff target for ${pendingHandoff.agent}`
  }

  const active = entries.find((entry) => entry.state && entry.state !== 'done')
  if (active) {
    return active.next_action || `Continue workflow with ${active.agent}`
  }

  return 'No active workflow detected'
}

const status = readJson(statusPath, {})
const events = readEvents(eventsPath)
const entries = Object.values(status)
  .filter((entry) => entry && matchesFilter(entry))
  .sort((a, b) => {
    const left = a.last_update ? new Date(a.last_update).getTime() : 0
    const right = b.last_update ? new Date(b.last_update).getTime() : 0
    return right - left
  })

if (!entries.length) {
  console.log('No workflow status found. Start a workflow and ensure the agent hooks are writing ledger events.')
  process.exit(0)
}

const urgentCount = entries.filter((entry) => health(entry) === 'urgent').length
const staleCount = entries.filter((entry) => health(entry) === 'stale').length
const invalidCount = entries.filter((entry) => health(entry) === 'invalid').length

console.log('# Workflow Audit')
console.log('')
console.log(`- Agents tracked: ${entries.length}`)
console.log(`- Urgent: ${urgentCount}`)
console.log(`- Stale: ${staleCount}`)
console.log(`- Invalid completions: ${invalidCount}`)
console.log(`- Next action: ${nextAction(entries)}`)
console.log('')
console.log('| Agent | State | Health | Updated | Gate | Verdict | Details | Handoff | Feature | Validation |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')

for (const entry of entries) {
  const updated = `${ageMinutes(entry.last_update)}m ago`
  console.log(
    `| ${entry.agent || 'unknown'} | ${entry.state || 'unknown'} | ${health(entry)} | ${updated} | ${gateType(entry)} | ${gateVerdict(entry)} | ${gateDetails(entry)} | ${entry.handoff_target || 'none'} | ${entry.feature_spec || 'n/a'} | ${entry.validation || 'none'} |`
  )
}

const recentEvents = events
  .filter((event) => matchesFilter(event))
  .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  .slice(0, 8)

if (recentEvents.length) {
  console.log('')
  console.log('## Recent Events')
  for (const event of recentEvents) {
    console.log(
      `- ${event.timestamp} | ${event.agent || 'unknown'} | ${event.action} | ${event.state || 'unknown'} | ${event.review_verdict || event.qa_verdict || 'n/a'} | ${event.summary || 'no summary'}`
    )
  }
}