import { create } from 'zustand';

// Which signed-in page is showing when no project is open.
export type Page = 'projects' | 'users';
export const useNav = create<{ page: Page }>(() => ({ page: 'projects' }));
export const goTo = (page: Page) => useNav.setState({ page });
