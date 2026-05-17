import { useEffect, useState } from 'react';

export function App(): JSX.Element {
  const [version, setVersion] = useState<string>('?');

  useEffect(() => {
    window.opencodex.getVersion().then(setVersion).catch(console.error);
  }, []);

  return (
    <main>
      <h1>OpenCodex</h1>
      <p>Version {version}</p>
      <p>Scaffold ready. See Todo.md for what to build next.</p>
    </main>
  );
}
