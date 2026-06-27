/**
 * Utilidades de transformación de strings.
 */

/**
 * Convierte cualquier string a kebab-case válido para slugs.
 * Ejemplos: "DO_Apps" → "do-apps", "voxkpi_AZ" → "voxkpi-az", "MyApp" → "my-app"
 */
export function toKebabCase(s: string): string {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')  // "XMLParser" → "XML-Parser"
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')        // "camelCase" → "camel-Case"
    .replace(/[_\s]+/g, '-')                        // _ y espacios → -
    .replace(/[^a-zA-Z0-9-]/g, '')                 // eliminar caracteres especiales
    .replace(/-+/g, '-')                            // múltiples guiones → uno
    .replace(/^-|-$/g, '')                          // trim guiones extremos
    .toLowerCase();
}
