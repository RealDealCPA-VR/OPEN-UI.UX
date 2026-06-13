/**
 * CD-21 — Projects with custom instructions. A project groups conversations in
 * the sidebar and carries free-form instructions that are prepended to the
 * system prompt of every chat in the project.
 */
export interface Project {
  id: string;
  name: string;
  instructions: string;
  createdAt: string;
}

export interface ProjectsChangedEvent {
  projects: Project[];
}
