import { FileTree } from '../components/FileTree';

export function CodebaseView(): JSX.Element {
  return (
    <section className="view codebase-view">
      <header className="codebase-head">
        <h1>Codebase</h1>
        <p>Workspace file tree. Click a file to (eventually) preview it; agent edits show pills.</p>
      </header>
      <FileTree />
    </section>
  );
}
