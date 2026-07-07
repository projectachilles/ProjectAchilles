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
    role: 'Founder, F0RT1KA',
  },
  kendra: {
    id: 'kendra',
    name: 'Kendra Mazara',
    role: 'Deputy CISO - SB',
  },
};
