// Formats a server timestamp (or the current time) as a UTC HH:MM:SS clock string for chat lines.
export function getDateString(jsonDate) {
  const when = jsonDate ? new Date(Date.parse(jsonDate)) : new Date();
  return when.toISOString().slice(11, 19);
}

// Reloads the page so a finished or broken session starts again from the login form.
export function reloadPage() {
  window.location.reload();
}
