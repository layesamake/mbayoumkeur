// Contenu de la page « Questions fréquentes » : une seule source pour l'affichage et pour les données structurées (FAQPage, Google).
// Les réponses ne décrivent que ce que le site fait réellement (commande par WhatsApp, sans paiement en ligne, livraison organisée
// après validation). Frais, délais et zones de livraison ne sont pas inventés : ils sont confirmés par le point de vente.
export function faqGroups(shops = []) {
  const noms = shops.map((s) => s.name);
  const pdv = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}` : noms[0] || 'nos points de vente';
  return [
    {
      id: 'commander', titre: 'Commander',
      items: [
        ['Comment passer commande ?',
          'Parcourez la boutique et ajoutez chaque plante à votre sélection. Dans « Ma sélection », indiquez votre nom et votre adresse ou quartier de livraison, puis choisissez le point de vente auprès duquel commander : votre sélection part en un seul message WhatsApp.'],
        ['Faut-il créer un compte ?',
          'Non, aucun compte n’est nécessaire. Votre sélection est gardée sur votre téléphone ou votre ordinateur, jusqu’à ce que vous la vidiez.'],
        ['Puis-je modifier ma sélection avant de l’envoyer ?',
          'Oui. Dans « Ma sélection », vous changez les quantités ou vous videz la sélection. Rien n’est envoyé tant que vous n’appuyez pas sur le bouton WhatsApp.'],
        ['Mon message WhatsApp est-il une commande définitive ?',
          'C’est une demande de commande. Nous la validons avec vous par WhatsApp (disponibilité, prix, livraison) avant de la confirmer. Le total affiché dans « Ma sélection » est une estimation.'],
        ['Que veut dire « prix sur demande » ?',
          'Pour certains articles, le prix n’est pas affiché sur le site. Il vous est confirmé par WhatsApp au moment de la commande.'],
      ],
    },
    {
      id: 'paiement-livraison', titre: 'Paiement et livraison',
      items: [
        ['Faut-il payer en ligne ?',
          'Non, il n’y a pas de paiement en ligne sur le site. Les modalités de règlement sont convenues avec vous lors de la confirmation de la commande par WhatsApp.'],
        ['Comment se passe la livraison ?',
          'Une fois votre commande validée avec vous, nous organisons la livraison à l’adresse ou au quartier que vous avez indiqué. Plus votre adresse est précise, plus la livraison est simple.'],
        ['Quels sont les frais et les délais de livraison ?',
          'Ils dépendent de votre adresse et de votre commande. Ils vous sont indiqués par le point de vente lorsque vous échangez avec lui par WhatsApp ; n’hésitez pas à les demander dans votre message.'],
        ['Quel point de vente dois-je contacter ?',
          `Mbayoumkeur a deux points de vente : ${pdv}. Choisissez le plus proche de vous. Leurs numéros de téléphone et de WhatsApp sont sur la page Contact.`],
      ],
    },
    {
      id: 'plantes', titre: 'Les plantes',
      items: [
        ['Comment choisir et entretenir mes plantes ?',
          'Les fiches produit donnent, quand l’information est disponible, les conseils d’entretien de la plante, et la page « Conseils d’entretien » rassemble les gestes essentiels (arrosage, soleil, sol, plantation). Pour un conseil adapté à votre situation (pot, balcon, jardin, terrain), écrivez-nous sur WhatsApp.'],
        ['Une plante est marquée « Indisponible », que faire ?',
          'Elle n’est pas en stock pour le moment. Écrivez-nous sur WhatsApp pour savoir si elle revient bientôt ou pour demander une autre plante.'],
        ['Les photos correspondent-elles exactement aux plants livrés ?',
          'Les photos présentent la plante proposée. La taille et l’aspect d’un plant peuvent varier selon la saison et le producteur. Pour une précision avant de commander, demandez-la au point de vente.'],
        ['D’où viennent les plantes ?',
          'Elles viennent de nos producteurs partenaires, qui nous confient leurs plantes pour les proposer sur la boutique.'],
      ],
    },
    {
      id: 'producteurs', titre: 'Producteurs partenaires',
      items: [
        ['Je suis agriculteur : comment proposer mes plantes ?',
          'Les producteurs partenaires saisissent leurs plantes, avec photos, depuis l’Espace agriculteurs, une application pensée pour le téléphone et utilisable sur le terrain, même sans réseau. L’accès se fait avec un compte créé par Mbayoumkeur : contactez-nous pour en demander un.'],
      ],
    },
  ];
}

/** Données structurées schema.org (FAQPage) : texte brut des questions et réponses. */
export function faqJsonLd(groups) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: groups.flatMap((g) => g.items).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }).replace(/</g, '\\u003c');
}
