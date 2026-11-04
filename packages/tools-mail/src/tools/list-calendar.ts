import { z } from 'zod'

import { defineTool } from '@va/core'

import { isAccessFailure, isSpoken, type MailDeps, withGraph, ZAGREB_TZ } from '../access.js'
import { field } from '../clean.js'
import { zagrebDay, zagrebDayBounds } from '../zagreb.js'
import { type GraphAddress, personName, subjectMax } from './messages.js'

const CHAT_MAX = 20
const VOICE_MAX = 5
const PAGE = 50
const LOCATION_MAX = 120

interface GraphEvent {
  subject?: string | null
  start?: { dateTime?: string } | null
  end?: { dateTime?: string } | null
  isAllDay?: boolean | null
  isCancelled?: boolean | null
  location?: { displayName?: string | null } | null
  organizer?: GraphAddress | null
}

/** `2026-11-04T09:30:00.0000000` (local, as the Prefer header asks) → `2026-11-04T09:30`. */
const local = (dt: string | undefined): string | null => (dt ? dt.slice(0, 16) : null)
/** On a call: `09:30` on the day asked, `2026-11-03 09:30` when the event started or ends on
 * another day, so a multi-day event is not heard as today's. */
const spokenTime = (dt: string | undefined, day: string): string | null =>
  !dt ? null : dt.slice(0, 10) === day ? dt.slice(11, 16) : `${dt.slice(0, 10)} ${dt.slice(11, 16)}`

export function listCalendar(deps: MailDeps) {
  return defineTool({
    name: 'list_calendar',
    description:
      "List the events in the user's own Outlook calendar for one day (Europe/Zagreb), today when no date " +
      'is given, in start order. Returns per event the subject, start and end (local time), whether it is ' +
      'all-day, the location and the organizer name. Call it for "what do I have today", "am I free on ' +
      'Friday" or before proposing a time. For one day only: call it again for another day. It does not ' +
      "read anyone else's calendar and cannot create or change events.",
    input: z.object({
      date: z.iso
        .date()
        .optional()
        .describe(
          "The day as YYYY-MM-DD (Europe/Zagreb). Omit for today; work out other days from today's date.",
        ),
    }),
    requiredRoles: ['admin', 'member'],
    readOnly: true,
    async handler(input, ctx, extras, signal) {
      const spoken = isSpoken(extras.channel)
      const day = input.date ?? zagrebDay(deps.clock())
      const { start, end } = zagrebDayBounds(day)
      const result = await withGraph(deps, ctx, signal, (graph) =>
        graph.get<{ value: GraphEvent[]; '@odata.nextLink'?: string }>('/me/calendarView', {
          select: ['subject', 'start', 'end', 'isAllDay', 'isCancelled', 'location', 'organizer'],
          query: { startDateTime: start, endDateTime: end, $orderby: 'start/dateTime', $top: PAGE },
          prefer: [ZAGREB_TZ],
          signal,
        }),
      )
      if (isAccessFailure(result)) return result
      // More than a page in one day: the count is a floor, and the model is told so.
      const more = result['@odata.nextLink'] !== undefined
      if (spoken) {
        // A call hears the day's live events, times only, at most five.
        const live = result.value.filter((e) => e.isCancelled !== true)
        return {
          date: day,
          count: live.length,
          ...(more ? { more: true } : {}),
          events: live.slice(0, VOICE_MAX).map((e) => ({
            subject: field(e.subject, subjectMax(true)) || '(bez naslova)',
            all_day: e.isAllDay === true,
            start: e.isAllDay ? null : spokenTime(e.start?.dateTime, day),
            end: e.isAllDay ? null : spokenTime(e.end?.dateTime, day),
          })),
        }
      }
      return {
        date: day,
        count: result.value.length,
        ...(more ? { more: true } : {}),
        events: result.value.slice(0, CHAT_MAX).map((e) => ({
          subject: field(e.subject, subjectMax(false)) || '(bez naslova)',
          start: local(e.start?.dateTime),
          end: local(e.end?.dateTime),
          all_day: e.isAllDay === true,
          cancelled: e.isCancelled === true,
          location: field(e.location?.displayName, LOCATION_MAX) || null,
          organizer: personName(e.organizer, false),
        })),
      }
    },
  })
}
