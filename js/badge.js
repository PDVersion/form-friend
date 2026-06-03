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

// True when the badge name is missing/blank (ServiceM8 requires one).
export function badgeNameEmpty(badge) {
  return !(badge || "").trim();
}

// Derive a valid badge name from a form name: trim, then truncate to the limit.
// Returns "" for an empty/blank form name.
export function deriveBadgeName(formName) {
  return (formName || "").trim().slice(0, BADGE_NAME_MAX);
}

// A human-readable problem with the badge name, or null when it's valid.
export function badgeNameIssue(badge) {
  if (badgeNameEmpty(badge)) {
    return "Badge name can't be empty — give the form a name so a short badge can be derived, or type one.";
  }
  if (badgeNameTooLong(badge)) {
    return `Badge name is ${badge.length} characters — ServiceM8 requires fewer than 12. Shorten it before importing.`;
  }
  return null;
}
