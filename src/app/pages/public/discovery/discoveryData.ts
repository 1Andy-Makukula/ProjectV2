export type MediaType = 'video' | 'image';

export interface DiscoveryPost {
  id: string;
  type: MediaType;
  url: string;
  author: string;
  authorAvatar: string;
  shopName: string;
  caption: string;
  likes: number;
  comments: number;
  shares: number;
  itemPrice: number;
}

// A mix of high-quality Unsplash lifestyle images and a Pexels placeholder video
export const DISCOVERY_POSTS: DiscoveryPost[] = [
  {
    id: 'post_1',
    type: 'video',
    // High-quality vertical video placeholder from Pexels (free to use)
    url: 'https://videos.pexels.com/video-files/5849887/5849887-uhd_1440_2560_25fps.mp4',
    author: '@sarah_bakes',
    authorAvatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&q=80&fit=crop',
    shopName: 'The Artisan Bakery',
    caption: 'Fresh out of the oven! 🥐 Send someone a morning treat. #pastry #gifts',
    likes: 1240,
    comments: 45,
    shares: 120,
    itemPrice: 45.00,
  },
  {
    id: 'post_2',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=1080&q=80&fit=crop',
    author: '@gift_curator',
    authorAvatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=150&q=80&fit=crop',
    shopName: 'Luxe Botanicals',
    caption: 'Nothing says "thinking of you" like a fresh bouquet of peonies. 🌸✨',
    likes: 856,
    comments: 21,
    shares: 89,
    itemPrice: 350.00,
  },
  {
    id: 'post_3',
    type: 'video',
    // Pexels coffee pouring video
    url: 'https://videos.pexels.com/video-files/4315486/4315486-hd_1080_1920_30fps.mp4',
    author: '@lusaka_roasters',
    authorAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&q=80&fit=crop',
    shopName: 'Lusaka Roasters',
    caption: 'Perfect pour over for the perfect morning. ☕ Gift a bag of our signature blend!',
    likes: 2100,
    comments: 112,
    shares: 430,
    itemPrice: 120.00,
  },
  {
    id: 'post_4',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1512413914594-803f2e1a38de?w=1080&q=80&fit=crop',
    author: '@lifestyle_zed',
    authorAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&q=80&fit=crop',
    shopName: 'Zed Tech Hub',
    caption: 'Upgraded workspace essentials. 🎧 The perfect gift for the tech lover.',
    likes: 4320,
    comments: 89,
    shares: 210,
    itemPrice: 850.00,
  }
];
