// FORCE data seed module.
// No demo/example questions and no badges are seeded from code.
// Add real questions directly to Supabase table public.questions via SQL/CSV. Use category_key, not category label, to keep the database lean.

export const seedQuestions = [];

export const FORCE_CORE_CATEGORY = {
  key: 'force_core',
  label: 'FORCE CORE',
  description: 'Arah hidup, tujuan hidup, loyalitas, kesetiaan, attitude, manner, dan aturan.',
  selectable: false,
  locked: true,
  sort_order: 7,
};

export const FORCE_CATEGORIES = [
  { key: 'global', label: 'Global', description: 'Bahasa Inggris dan Geografi global seperti peta, bendera, dan bangsa-bangsa.', selectable: true, sort_order: 1 },
  { key: 'tech', label: 'Technology', description: 'Logika, matematika, dan teknologi.', selectable: true, sort_order: 2 },
  { key: 'media', label: 'Media', description: 'Istilah editing, media, visual thinking, dan cara melihat cakupan luas.', selectable: true, sort_order: 3 },
  { key: 'kitchen_cafe', label: 'Kitchen & Cafe', description: 'Bisnis praktikal, bahan makanan, teknik memasak, dan jenis makanan.', selectable: true, sort_order: 4 },
  { key: 'mentoring', label: 'Mentoring', description: 'Jiwa pengajar, komunikasi, dan public speaking.', selectable: true, sort_order: 5 },
  { key: 'orchestral', label: 'Orchestral', description: 'Musik, nada, dan alat musik.', selectable: true, sort_order: 6 },
  FORCE_CORE_CATEGORY,
];

export const SELECTABLE_DUEL_CATEGORIES = FORCE_CATEGORIES.filter((category) => category.selectable);

export const DUEL_CATEGORY_RULES = {
  totalQuestions: 5,
  selectedCategoryQuestions: 4,
  forceCoreQuestions: 1,
  randomMode: "No category selected = at least 1 FORCE CORE + 4 unrestricted active questions",
  inviteCountdownSeconds: 30,
};

export function makeBadgeSeeds() {
  return [];
}

export default function handler(req, res) {
  return res.status(404).json({
    error: 'Data seed module only. Use /api/[...path].js for FORCE API routes.',
  });
}
