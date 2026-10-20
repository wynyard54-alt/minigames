// 게임 효과음: 소리 파일 없이 브라우저가 직접 합성한다 (Web Audio). 인터넷이 없어도 된다.
// 휴대폰은 사용자가 화면을 한 번 터치해야 소리를 낼 수 있어서 unlock()을 터치할 때 불러 준다.
window.GameSound = (() => {
  let ctx = null;
  let master = null;
  let noise = null;
  let muted = false;
  try {
    muted = localStorage.getItem('mg:mute') === '1';
  } catch {}

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.8;
      master.connect(ctx.destination);
      // 1초짜리 잡음 (사락, 퍽, 폭발 소리의 재료)
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.8;
    try {
      localStorage.setItem('mg:mute', m ? '1' : '0');
    } catch {}
  }

  // 음 하나: 파형, 시작·끝 높이(Hz), 길이(초), 크기
  function tone(type, f0, f1, dur, vol, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // 잡음 한 번: 필터 종류와 높이로 소리 색깔을 정한다
  function hiss(filter, freq, freq1, dur, vol, delay = 0, q = 1) {
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freq1 !== freq) f.frequency.exponentialRampToValueAtTime(freq1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    shoot: (v) => {
      tone('square', 880, 260, 0.09, 0.12 * v);
      hiss('highpass', 2500, 2500, 0.05, 0.08 * v);
    },
    hitEnemy: (v) => tone('sine', 1500, 1500, 0.05, 0.18 * v), // 내가 맞혔을 때 '틱'
    hurt: (v) => {
      hiss('lowpass', 600, 200, 0.15, 0.35 * v);
      tone('sine', 160, 90, 0.15, 0.25 * v);
    },
    die: (v) => {
      tone('sawtooth', 420, 70, 0.6, 0.18 * v);
      hiss('lowpass', 900, 120, 0.5, 0.2 * v);
    },
    kill: (v) => {
      tone('triangle', 880, 880, 0.09, 0.25 * v);
      tone('triangle', 1320, 1320, 0.14, 0.25 * v, 0.09);
    },
    // 부시에 들어갈 때 '사락': 높은 잡음을 짧게 여러 번 흔든다
    rustle: (v) => {
      for (let i = 0; i < 4; i++) hiss('bandpass', 3200 + Math.random() * 1500, 2200, 0.09, 0.22 * v, i * 0.045 + Math.random() * 0.02, 0.9);
    },
    reload: (v) => {
      hiss('highpass', 3000, 3000, 0.03, 0.25 * v);
      hiss('highpass', 2000, 2000, 0.04, 0.3 * v, 0.12);
    },
    superReady: (v) => {
      tone('sine', 660, 660, 0.1, 0.15 * v);
      tone('sine', 990, 990, 0.1, 0.15 * v, 0.1);
      tone('sine', 1320, 1320, 0.18, 0.15 * v, 0.2);
    },
    boom: (v) => {
      hiss('lowpass', 2000, 80, 0.7, 0.5 * v);
      tone('sine', 90, 40, 0.6, 0.4 * v);
    },
    beep: (v) => tone('sine', 660, 660, 0.12, 0.2 * v),
    go: (v) => tone('sine', 990, 990, 0.35, 0.25 * v),
    heal: (v) => tone('sine', 520, 780, 0.25, 0.05 * v),
    win: (v) => [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.18, 0.22 * v, i * 0.12)),
    lose: (v) => [392, 330, 262].forEach((f, i) => tone('triangle', f, f, 0.25, 0.2 * v, i * 0.18)),
  };

  const last = {};
  // play(이름, 크기, 최소 간격ms): 같은 소리가 너무 촘촘하면 건너뛴다
  function play(name, vol = 1, gap = 0) {
    if (!ctx || muted || ctx.state !== 'running' || !SOUNDS[name]) return;
    const now = performance.now();
    if (gap && last[name] && now - last[name] < gap) return;
    last[name] = now;
    SOUNDS[name](vol);
  }

  return { unlock, play, setMuted, isMuted: () => muted };
})();
