import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import fr from '../locales/fr/translation.json'

// French only for now. To add Arabic: add src/locales/ar/translation.json, register it in
// `resources` and add 'ar' to `supportedLngs`. The document direction follows the language
// automatically (see below), and the components only use logical CSS (start/end), so a
// right-to-left layout needs no change in them.
void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr } },
  lng: 'fr',
  fallbackLng: 'fr',
  supportedLngs: ['fr'],
  // React already escapes everything it renders.
  interpolation: { escapeValue: false },
})

function applyDocumentLanguage(language: string) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
  document.documentElement.dir = i18n.dir(language)
}

applyDocumentLanguage(i18n.language)
i18n.on('languageChanged', applyDocumentLanguage)

export default i18n
