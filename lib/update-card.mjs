export const slugPattern=/^[a-z0-9][a-z0-9-]{0,95}$/
export function validCard(card){
  return card && typeof card.slug==='string' && slugPattern.test(card.slug) && ['gameplay','modeling'].includes(card.kind)
    && typeof card.release_sha==='string' && /^[0-9a-f]{7,64}$/.test(card.release_sha)
    && Object.entries({title:20,summary:80,how_to:60}).every(([key,max])=>typeof card[key]==='string' && card[key].trim() && [...card[key]].length<=max)
    && Array.isArray(card.images) && card.images.length>=1 && card.images.length<=3
}
