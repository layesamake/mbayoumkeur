// Contenu de la page « Conseils d'entretien » : repères généraux de culture, valables pour la plupart des plants vendus (légumes, aromatiques,
// arbres fruitiers) sous un climat chaud et sec comme celui de Thiès ou de Grand Mbour. Ce sont des repères, pas des consignes propres à une
// plante : les conseils précis de chaque plante sont repris de sa fiche (champ « conseils d'entretien »).
export const GESTES = [
  {
    id: 'arrosage', titre: 'Arroser', icone: '💧',
    resume: 'Peu souvent mais en profondeur, et à la bonne heure.',
    points: [
      'Arrosez tôt le matin ou en fin de journée, quand le soleil est bas : l’eau profite aux racines au lieu de s’évaporer.',
      'Visez le pied de la plante plutôt que les feuilles, qui supportent mal les gouttes en plein soleil.',
      'Un arrosage copieux de temps en temps vaut mieux que de petits arrosages tous les jours : les racines descendent chercher l’eau.',
      'Test du doigt : enfoncez-le de 2 à 3 cm dans la terre ; si elle est sèche, arrosez, si elle est fraîche, attendez.',
      'Jamais d’eau stagnante : videz la soucoupe d’un pot après l’arrosage.',
    ],
  },
  {
    id: 'lumiere', titre: 'Soleil et chaleur', icone: '☀️',
    resume: 'La plupart des plants aiment le soleil, mais pas tout de suite.',
    points: [
      'Légumes, aromatiques et arbres fruitiers demandent en général 6 heures de soleil par jour ou plus.',
      'Un jeune plant ou une plante qui sort d’un endroit ombragé doit s’habituer : gardez-le à la lumière douce quelques jours avant de l’exposer.',
      'Aux heures les plus brûlantes de la saison chaude, une ombrière légère, un filet ou un voile protège les jeunes plants et les plantes en pot.',
      'Les feuilles qui jaunissent ou brunissent sur les bords peuvent signaler trop de soleil ou trop peu d’eau.',
    ],
  },
  {
    id: 'sol', titre: 'Sol et terreau', icone: '🌱',
    resume: 'Une terre riche qui garde la fraîcheur sans retenir l’eau.',
    points: [
      'Préférez un sol meuble et riche en matière organique, qui se draine bien.',
      'En pot : mélangez terreau, compost mûr et un peu de sable pour alléger le mélange.',
      'Un paillage de paille ou de feuilles sèches autour du pied garde l’humidité, protège les racines de la chaleur et freine les mauvaises herbes.',
      'Apportez du compost ou un engrais organique pendant la période de croissance, sans excès.',
    ],
  },
  {
    id: 'plantation', titre: 'Planter', icone: '🪴',
    resume: 'Quelques précautions pour que le plant s’installe bien.',
    points: [
      'Plantez de préférence en fin de journée ou par temps couvert.',
      'Arrosez le plant dans son sachet avant de le sortir, puis dégagez la motte sans la casser.',
      'Creusez un trou un peu plus large que la motte et gardez le collet (là où la tige rejoint les racines) au niveau du sol.',
      'Tassez doucement, arrosez abondamment, puis maintenez la terre fraîche pendant les premières semaines.',
      'Gardez de la place entre les plants : ils grandissent.',
    ],
  },
  {
    id: 'pots', titre: 'Cultiver en pot', icone: '🏺',
    resume: 'Drainage, taille du pot et chaleur.',
    points: [
      'Le pot doit être percé, avec une couche de graviers ou de tessons au fond pour évacuer l’eau.',
      'Choisissez un pot assez grand pour les racines : rempotez quand elles sortent par le fond ou que l’arrosage s’écoule trop vite.',
      'Les pots sombres chauffent au soleil : placez-les à mi-ombre ou protégez-les de la chaleur.',
      'Une plante en pot sèche plus vite qu’en pleine terre : surveillez l’arrosage en saison chaude.',
    ],
  },
  {
    id: 'livraison', titre: 'À la livraison', icone: '📦',
    resume: 'Les premiers jours comptent.',
    points: [
      'Sortez les plantes de leur emballage dès la livraison et arrosez-les légèrement.',
      'Gardez-les à l’ombre ou à la lumière douce 2 à 3 jours avant de les exposer au plein soleil.',
      'Des feuilles un peu fatiguées après le trajet sont fréquentes : elles se redressent avec de l’eau et du repos.',
    ],
  },
  {
    id: 'sante', titre: 'Surveiller la santé', icone: '🔍',
    resume: 'Mieux vaut repérer tôt.',
    points: [
      'Regardez régulièrement le dessous des feuilles, où se cachent souvent les insectes.',
      'Retirez les feuilles abîmées ou malades et gardez le pied propre.',
      'Évitez l’excès d’eau et le manque d’aération, qui favorisent la pourriture.',
      'Un doute ? Envoyez-nous une photo par WhatsApp : nous vous conseillons.',
    ],
  },
];
