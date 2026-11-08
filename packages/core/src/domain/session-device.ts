/** A display hint from User-Agent, never an identity or authorization signal. */
export function sessionDevice(input: string | null) {
  const agent = (input ?? '').slice(0, 512);
  const browserRules: [RegExp, string][] = [
    [/Edg(?:A|iOS)?\/([\d]+)/, 'Edge'],
    [/SamsungBrowser\/([\d]+)/, 'Samsung Internet'],
    [/(?:OPR|Opera)\/([\d]+)/, 'Opera'],
    [/(?:Firefox|FxiOS)\/([\d]+)/, 'Firefox'],
    [/(?:Chrome|CriOS)\/([\d]+)/, 'Chrome'],
    [/Version\/([\d]+).*Safari\//, 'Safari'],
  ];
  let browser = 'مرورگر ناشناخته';
  for (const [pattern, name] of browserRules) {
    const match = agent.match(pattern);
    if (match) {
      browser = `${name} ${match[1].slice(0, 4)}`;
      break;
    }
  }
  const os =
    /iPad/.test(agent) || /Macintosh.*Mobile/.test(agent)
      ? 'iPadOS'
      : /iPhone|iPod/.test(agent)
        ? 'iOS'
        : /Android/.test(agent)
          ? 'Android'
          : /Windows/.test(agent)
            ? 'Windows'
            : /CrOS/.test(agent)
              ? 'ChromeOS'
              : /Macintosh|Mac OS X/.test(agent)
                ? 'macOS'
                : /Linux|X11/.test(agent)
                  ? 'Linux'
                  : 'سیستم‌عامل ناشناخته';
  const kind =
    /iPad|Tablet/.test(agent) || os === 'iPadOS' || (os === 'Android' && !/Mobile/.test(agent))
      ? 'tablet'
      : /Mobile|iPhone|iPod/.test(agent) || os === 'Android'
        ? 'phone'
        : /Windows|Macintosh|Linux|CrOS|X11/.test(agent)
          ? 'desktop'
          : 'unknown';
  return { browser, os, kind };
}
