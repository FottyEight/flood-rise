// Talks to start.ng through its hidden connect page (https://start.ng/docs#talk-to-start-ng).
// The connect page only answers games served from *.start.ng, so anywhere else
// (a local file, localhost) every call resolves to null and the game plays as a guest.

const START_NG = 'https://start.ng';
let frame;

function connectFrame() {
  frame ??= new Promise((resolve, reject) => {
    const el = document.createElement('iframe');
    el.src = `${START_NG}/connect`;
    el.hidden = true;
    el.title = 'start.ng connect';
    el.onload = () => resolve(el);
    el.onerror = reject;
    document.body.append(el);
  });
  return frame;
}

// Sends a message and resolves to start.ng's reply, or null if it didn't answer.
async function askStartNg(message, replyType, timeoutMs = 5000) {
  let el;
  try {
    el = await connectFrame();
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const done = (reply) => { clearTimeout(timer); removeEventListener('message', onMessage); resolve(reply); };
    const timer = setTimeout(() => done(null), timeoutMs);
    function onMessage(e) {
      if (e.origin !== START_NG || e.source !== el.contentWindow) return;
      if (e.data?.type === replyType && e.data.requestId === requestId) done(e.data);
    }
    addEventListener('message', onMessage);
    el.contentWindow.postMessage({ ...message, requestId }, START_NG);
  });
}

// start.ng's guest look, used until (or unless) the connect page answers.
export const FALLBACK_GUEST = {
  name: 'Guest',
  style: {
    body: 'male', primaryColor: '#8a8f98', secondaryColor: '#3d4250', skinColor: '#a26a42',
    hairColor: '#1b1410', hair: 'short', hat: 'none', accessory: 'none',
  },
  face: null,
};

export const onStartNg = location.hostname.endsWith('.start.ng');
export const cameAsGuest = new URLSearchParams(location.search).has('guest');

// { user, guest } where user is null for guests. Never throws.
export async function whoami() {
  const reply = await askStartNg({ type: 'startng:whoami' }, 'startng:user', onStartNg ? 5000 : 1500);
  return {
    user: reply?.user ?? null,
    guest: reply?.guest ?? FALLBACK_GUEST,
    connected: !!reply,
  };
}

// stats must match startng.json exactly: { height, sachets }.
export async function saveRun(stats) {
  const reply = await askStartNg({ type: 'startng:score', stats }, 'startng:scoreSaved');
  return reply ?? { ok: false, error: 'Could not reach start.ng' };
}

export async function leaderboard(limit = 10) {
  const reply = await askStartNg({ type: 'startng:leaderboard', limit }, 'startng:leaderboardData');
  return reply?.ok ? reply.entries : null;
}

export function signIn() {
  location.href = `${START_NG}/?return_to=${encodeURIComponent(location.origin + location.pathname)}`;
}
