// Profil d'altitude (SVG) à partir du profil lissé fourni par le moteur.
type Props = { profile: [number, number][]; color: string };

export default function ElevationProfile({ profile, color }: Props) {
  if (profile.length < 2) return null;
  const maxD = profile.at(-1)![0] || 1;
  const hs = profile.map((p) => p[1]);
  const min = Math.min(...hs), max = Math.max(...hs);
  // Échelle verticale d'au moins 30 m : un profil plat doit paraître plat.
  const span = Math.max(30, max - min);
  const lo = min - (span - (max - min)) / 2;
  const X = (d: number) => (d / maxD) * 300;
  const Y = (h: number) => 82 - ((h - lo) / span) * 70;
  const line = profile.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  return (
    <svg className="profile-svg" viewBox="0 0 300 90" preserveAspectRatio="none" role="img" aria-label={`Altitude entre ${Math.round(min)} et ${Math.round(max)} m`}>
      <path d={`${line}L300,90L0,90Z`} fill={color} fillOpacity={0.15} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <text x="3" y="11" fontSize="9" fill="currentColor" opacity={0.6}>{Math.round(max)} m</text>
      <text x="3" y="88" fontSize="9" fill="currentColor" opacity={0.6}>{Math.round(min)} m</text>
    </svg>
  );
}
