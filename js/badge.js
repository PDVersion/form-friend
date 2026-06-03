// badge.js — ServiceM8 form badge-name constraints.
//
// ServiceM8 rejects a form badge name of 12 or more characters when importing
// a .sm8f, so a valid badge name must be FEWER THAN 12 characters (max 11).
// These helpers are pure (no DOM) so they can be unit-tested.

// Maximum allowed badge-name length (the value must be < 12 characters).
export const BADGE_NAME_MAX = 11;

// True when the badge name violates the ServiceM8 length limit.
export function badgeNameTooLong(badge) {
  return (badge || "").length > BADGE_NAME_MAX;
}

// Derive a valid badge name from a form name: trim, then truncate to the limit.
// Returns "" for an empty/blank form name.
export function deriveBadgeName(formName) {
  return (formName || "").trim().slice(0, BADGE_NAME_MAX);
}
