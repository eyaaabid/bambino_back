import 'dotenv/config'
import mongoose from 'mongoose'
import { env } from '../config/env.js'
import { Complication } from '../models/Complication.js'
import { Hospital } from '../models/Hospital.js'

const hospitals: Record<string, string[]> = {
  'Hôpital Wassila Bourguiba': ['Service A', 'Service B', 'Service C', 'Service D'],
  'Hôpital Charles-Nicolle': ['Service de gynécologie obstétrique'],
  'Hôpital Aziza Othmana': ['Service de gynécologie obstétrique'],
}

const complications = [
  {
    slug: 'hemorragie',
    title: 'Hémorragie',
    description:
      'Saignement anormal pendant la grossesse. Peut survenir à différents stades et nécessite une évaluation médicale rapide.',
    symptoms: 'Saignement rouge vif ou abondant, douleurs abdominales, étourdissements, perte de conscience.',
    actions: "Appeler le 15 ou les urgences immédiatement. Rester allongée. Ne pas prendre d'aspirine.",
    severity: 'urgent',
    order: 1,
  },
  {
    slug: 'pre-eclampsie',
    title: 'Pré-éclampsie',
    description:
      'Trouble hypertensive de la grossesse associé à une protéinurie, pouvant mettre en danger la mère et le fœtus.',
    symptoms:
      'Maux de tête persistants, troubles visuels (mouches, flou), œdèmes importants (visage, mains), douleurs abdominales hautes.',
    actions:
      'Contacter votre médecin ou la maternité immédiatement. En cas de signes sévères, appeler le 15.',
    severity: 'high',
    order: 2,
  },
  {
    slug: 'diabete-gestationnel',
    title: 'Diabète gestationnel',
    description:
      'Intolérance au glucose apparaissant pendant la grossesse. Nécessite un suivi alimentaire et parfois un traitement.',
    symptoms:
      'Souvent asymptomatique. Dépistage par test HGPO. Parfois soif intense, fatigue, infections urinaires à répétition.',
    actions:
      'Suivre les recommandations du médecin (régime, surveillance glycémique). Consulter en cas de malaise ou signes d’hyperglycémie.',
    severity: 'moderate',
    order: 3,
  },
  {
    slug: 'menace-accouchement-premature',
    title: "Menace d'accouchement prématuré",
    description: 'Contractions utérines régulières avant 37 SA pouvant conduire à un accouchement prématuré.',
    symptoms:
      'Contractions régulières et douloureuses, douleurs dans le bas du dos, pression pelvienne, pertes liquidiennes.',
    actions: 'Appeler la maternité ou le 15. Allongée sur le côté gauche. Ne pas rester debout.',
    severity: 'urgent',
    order: 4,
  },
  {
    slug: 'rupture-prematuree-membranes',
    title: 'Rupture prématurée des membranes',
    description:
      "Perte du liquide amniotique avant le début du travail. Risque d'infection et d'accouchement prématuré.",
    symptoms: 'Écoulement liquidien continu (souvent clair), sensation de « fuite » impossible à retenir.',
    actions: 'Appeler la maternité immédiatement. Ne pas faire de bain. Se rendre aux urgences obstétricales.',
    severity: 'urgent',
    order: 5,
  },
]

async function main() {
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000 })
  const dbName = mongoose.connection.db?.databaseName ?? '(inconnue)'
  console.log(`Connexion MongoDB — base utilisée : "${dbName}" (vérifiez que c’est la même que dans MONGODB_URI de l’API).`)

  for (const [hospitalName, services] of Object.entries(hospitals)) {
    let h = await Hospital.findOne({ name: hospitalName })
    if (!h) {
      h = await Hospital.create({
        name: hospitalName,
        services: services.map((name) => ({ name })),
      })
    } else {
      const existing = new Set((h.services as { name: string }[]).map((s) => s.name))
      for (const name of services) {
        if (!existing.has(name)) {
          h.services.push({ name } as { name: string })
          existing.add(name)
        }
      }
      await h.save()
    }
  }

  for (const row of complications) {
    await Complication.findOneAndUpdate({ slug: row.slug }, { $set: row }, { upsert: true })
  }

  const count = await Hospital.countDocuments()
  console.log(`Seed completed: hospitals + complications (${count} hôpitaux dans la base "${dbName}").`)
  await mongoose.disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
