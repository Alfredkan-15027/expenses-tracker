// Light haptic feedback.
// iOS Safari (18+) plays a system haptic when a <input type="checkbox" switch> is toggled via its label;
// Android uses the Vibration API. Everywhere else this is a silent no-op.

let label = null;

function ensure() {
  if (label) return label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = 'haptic-switch';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  label = document.createElement('label');
  label.htmlFor = input.id;
  label.className = 'haptic-proxy';
  label.setAttribute('aria-hidden', 'true');
  label.appendChild(input);
  document.body.appendChild(label);
  return label;
}

export function haptic(kind = 'light') {
  // Haptics only make sense (and are only allowed) during a real user gesture.
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  try {
    if (navigator.vibrate) {
      navigator.vibrate(kind === 'error' ? [18, 60, 18] : kind === 'success' ? 14 : 8);
      return;
    }
    ensure().click();
    if (kind === 'error' || kind === 'success') setTimeout(() => ensure().click(), 90);
  } catch { /* ignore */ }
}
