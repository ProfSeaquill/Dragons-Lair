export const cost = {
  dmg: (L)=> Math.floor(10 * Math.pow(1.25, L.dmg)),
  rate:(L)=> Math.floor(15 * Math.pow(1.3,  L.rate)),
  burn:(L)=> Math.floor(40 * Math.pow(1.35, L.burn)),
  pierce:(L)=> Math.floor(60 * Math.pow(1.4,  L.pierce)),
};
export const waveHP = (n)=> Math.floor(60 * Math.pow(1.18, n-1));
export const bossHP = (n)=> Math.floor(waveHP(n) * 10);
export const reward = (n, boss)=> boss ? Math.floor(50 + n*12) : Math.floor(10 + n*3);
