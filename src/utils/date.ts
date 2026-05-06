/**
 * Process-wide timezone state for the MCP server. Both functions in this
 * module mutate `luxon.Settings.defaultZone`, which luxon uses as the
 * fallback zone for every DateTime.local()/fromObject() that does not
 * specify a zone explicitly. Side-effect is global; calling
 * `initializeTimezone` again switches the zone for every subsequent date
 * operation in the process.
 */
import { Settings } from 'luxon';
import { DEFAULT_TIMEZONE } from '../defaults.js';

let currentTimezone = DEFAULT_TIMEZONE;

/**
 * Apply an IANA timezone identifier (e.g. `Europe/Moscow`, `UTC`) to the
 * process. Updates the module-local `currentTimezone` cache and assigns
 * `luxon.Settings.defaultZone` so every subsequent luxon DateTime defaults
 * to the new zone. Repeated calls are allowed and replace the previously
 * configured zone — there is no validation of the IANA string here; an
 * invalid identifier results in a luxon "invalid zone" DateTime later.
 */
export function initializeTimezone(timezone: string): void {
  currentTimezone = timezone;
  Settings.defaultZone = timezone;
}

/**
 * Return the timezone last set via `initializeTimezone`, or
 * `DEFAULT_TIMEZONE` if no override has been applied since process start.
 * Pure read — does not consult `luxon.Settings.defaultZone` directly, so
 * the value reflects only changes made through this module.
 */
export function getTimezone(): string {
  return currentTimezone;
}
