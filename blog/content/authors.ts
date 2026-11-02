export interface Author {
  id: string;
  name: string;
  role: string;
  avatar?: string;
}

export const authors: Record<string, Author> = {
  james: {
    id: 'james',
    name: 'James Pichardo',
    role: 'Founder, ProjectAchilles',
  },
  kendra: {
    id: 'kendra',
    name: 'Kendra Mazara',
    role: 'Deputy CISO',
  },
};
