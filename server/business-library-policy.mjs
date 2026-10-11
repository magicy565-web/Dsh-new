/** Business files stay local even when a generic artifact id/version is selected. */
export function isBusinessLibraryArtifact(state, artifactOrId) {
  const artifact = typeof artifactOrId === 'string'
    ? (state.artifacts || []).find(item => item.id === artifactOrId)
    : artifactOrId;
  const id = typeof artifactOrId === 'string' ? artifactOrId : artifact?.id;
  if (artifact?.metadata?.businessLibrary?.visibility === 'internal') return true;
  if (!id) return false;
  const library = state.businessLibrary;
  return (library?.documents || []).some(document => (document.versions || []).some(version => version.asset?.artifactId === id))
    || (library?.products || []).some(product => (product.images || []).some(image => image.asset?.artifactId === id));
}
