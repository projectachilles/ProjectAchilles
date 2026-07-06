import type { MetadataRoute } from 'next';
import { getAllPosts, getAllTags } from '@/lib/posts';

const SITE_URL = 'https://blog.projectachilles.io';

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts({ includeDrafts: false });
  return [
    { url: SITE_URL, lastModified: posts[0]?.date },
    ...posts.map((post) => ({
      url: `${SITE_URL}/posts/${post.slug}`,
      lastModified: post.date,
    })),
    ...getAllTags({ includeDrafts: false }).map(({ tag }) => ({
      url: `${SITE_URL}/tags/${tag}`,
    })),
  ];
}
