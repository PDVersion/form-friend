// badge.js — ServiceM8 form badge-name constraints.
//
// ServiceM8 has two badge-name length checks: importing a .sm8f rejects 12+
// characters, but the in-app form builder warns at 11+, so the real ceiling is
// 10 characters. A valid badge name is therefore AT MOST 10 characters.
//
// Badge names also work best as a single token — ServiceM8 badge widgets show
// them on a small chip, so the convention is camelCase or ALL CAPS with no
// spaces (e.g. "siteSafety" or "SITESAFETY").
//
// These helpers are pure (no DOM) so they can be unit-tested.

// Maximum allowed badge-name length (the SM8 builder warns at 11, so 10 is max).
export const BADGE_NAME_MAX = 10;

// True when the badge name exceeds the ServiceM8 length limit.
export function badgeNameTooLong(badge) {
  return (badge || "").length > BADGE_NAME_MAX;
}

// True when the badge name contains whitespace — i.e. it is not the
// recommended single-token camelCase / ALL CAPS form.
export function badgeNameHasSpaces(badge) {
  return /\s/.test(badge || "");
}

// Derive a valid badge name from a form name: collapse the words into a single
// camelCase token (so there are no spaces) and truncate to the limit.
// A single word keeps its original casing. Returns "" for an empty form name.
export function deriveBadgeName(formName) {
  const words = (formName || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const camel =
    words.length === 1
      ? words[0]
      : words
          .map((w, i) =>
            i === 0
              ? w.charAt(0).toLowerCase() + w.slice(1)
              : w.charAt(0).toUpperCase() + w.slice(1)
          )
          .join("");
  return camel.slice(0, BADGE_NAME_MAX);
}
