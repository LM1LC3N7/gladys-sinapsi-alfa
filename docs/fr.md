# Sinapsi Alfa

Intégration non officielle, sans lien avec Sinapsi. Elle lit le **Sinapsi
Alfa**, le boîtier qui lit les compteurs électriques italiens 2G (et, s'il y
en a un, le compteur de production) par la « Chain 2 », par son **serveur
Modbus TCP local** : sans cloud, sans compte, sans clé. **Lecture seule** : la
seule requête envoyée est « lire des registres de maintien » (fonction Modbus
3), une lecture toutes les 30 secondes au plus.

**Jamais testé avec un vrai appareil** : elle a été construite à partir de
l'intégration Home Assistant ha-sinapsi-alfa (Alessandro Del Prete, MIT) et de
sa carte des registres. La documentation Sinapsi des registres pour le
firmware actuel n'a pas été trouvée : les adresses sont celles de cette
intégration, les mêmes dans un autre projet indépendant. Les retours sont les
bienvenus.

## Ce que vous obtenez

Un appareil, **Sinapsi Alfa**. Ses fonctions apparaissent selon ce que l'Alfa
montre (pas de fonctions de production sans données de production, pas de
fonctions d'injection avant le premier kWh injecté) :

| Fonction                                         | Nature                        |
| ------------------------------------------------ | ----------------------------- |
| Puissance du logement                            | capteur d'énergie, W          |
| Puissance prélevée                               | réseau, puissance prélevée, W |
| Puissance injectée                               | réseau, puissance injectée, W |
| Puissance produite                               | production, W                 |
| Énergie prélevée (index)                         | index d'énergie, kWh          |
| Énergie injectée (index)                         | réseau, énergie injectée, kWh |
| Énergie produite (index)                         | index de production, kWh      |
| Puissance prélevée, moyenne du quart d'heure (W) | capteur simple                |
| Puissance injectée, moyenne du quart d'heure (W) | capteur simple                |
| Tranche horaire (1 = F1 ... 6 = F6)              | capteur simple                |
| Avis de coupure                                  | capteur simple, 1 = avis      |
| Coupure dans (s)                                 | capteur simple, secondes      |

Les noms des fonctions sont en anglais dans Gladys (« Home power », « Power
drawn », « Energy drawn (index) »…).

- **Puissance du logement** = puissance prélevée + puissance produite -
  puissance injectée. Sans données de production (voir plus bas), elle n'est
  envoyée que pour un logement qui n'a jamais injecté (c'est alors la
  puissance prélevée).
- **L'énergie prélevée** alimente le suivi énergétique de Gladys
  (consommation et coût) ; **l'énergie produite** alimente la production.
  **L'énergie injectée** n'est comptée ni comme consommation ni comme
  production.
- Les **trois index** sont des totaux à vie. Ils sont publiés au plus une
  fois par minute et vérifiés avant, chacun par sa garde : une valeur à 0
  n'est jamais envoyée ; toute baisse, même de 1 Wh, ou un saut plus grand
  que ce qui a pu passer (la « puissance plausible la plus haute » de la
  configuration, 100 kW par défaut, sur le temps écoulé depuis la dernière
  valeur) est **retenu** (la dernière valeur acceptée est renvoyée) et affiché
  dans l'état de l'intégration. Si c'est juste (un nouveau compteur, une
  remise à zéro, un autre Alfa), cliquez deux fois sur **Accepter l'index
  retenu** (voir Boutons). Enregistrer la configuration ne l'accepte jamais.
  Un index retenu le reste après un redémarrage.
- La **tranche horaire** est un nombre de 1 à 6 (F1 à F6) ; une autre valeur
  n'est pas envoyée.
- **L'avis de coupure** vaut 1 tant que le compteur annonce une coupure
  (trop de puissance prélevée), 0 sinon ; **Coupure dans** donne les secondes
  restantes quand le compteur les donne (elle n'est plus mise à jour une fois
  l'avis terminé). L'état affiche aussi l'heure de la coupure, en UTC.
- Les totaux journaliers par tranche (registres 30 à 65) ne sont pas lus.

## Valeurs qui ne sont pas envoyées

- **L'Alfa démarre** : après un redémarrage, ses registres valent 0 pendant
  quelques minutes. Une lecture dont l'énergie prélevée ou la tranche horaire
  vaut 0 n'envoie rien du tout (l'état dit que l'Alfa démarre).
- **Non disponible** : une puissance de 65535 W, un total de 4294967295 Wh.
- **Données de production** : valables seulement si le total de production
  est au-dessus de 0 et pas en dessous de l'énergie injectée (on n'injecte
  jamais plus qu'on ne produit). Sinon la production et la puissance du
  logement ne sont pas envoyées et l'état le dit.
- **Valeurs figées** : quand aucun registre de l'Alfa n'a changé depuis 30
  minutes, rien n'est envoyé tant qu'aucun ne bouge (l'état le dit). Cet âge
  est gardé dans `/data` d'un redémarrage à l'autre.

## Un Alfa par intégration

L'Alfa ne donne pas de numéro de série en Modbus : l'intégration lit un Alfa,
et son appareil est celui-là quelle que soit l'adresse. Si vous mettez un autre
Alfa derrière l'adresse, ses totaux ne suivent pas les anciens : les gardes
les retiennent jusqu'à ce que vous les acceptiez.

## Un seul client Modbus à la fois

L'Alfa ne sert **qu'un client Modbus TCP**. L'intégration ouvre la connexion
pour chaque lecture (quatre requêtes, l'une après l'autre, jamais deux à la
fois) et la ferme aussitôt : elle n'occupe l'Alfa qu'une fraction de seconde
toutes les 30 secondes. Un autre client Modbus connecté en permanence (une
configuration Modbus de Home Assistant, par exemple) peut empêcher les
lectures : l'état dit alors que la connexion n'a pas pu se faire.

## Mise en place

1. Trouvez l'adresse IP de l'Alfa dans votre box, et donnez-lui de préférence
   une adresse fixe.
2. Dans Gladys, ouvrez l'intégration, saisissez cette adresse (avec un port
   seulement s'il n'est pas 502) et enregistrez.
3. Dans l'onglet **Découverte**, créez l'appareil.

## Boutons

- **Tester la connexion** : lit l'Alfa une fois quand une lecture est due
  (jamais plus d'une toutes les 30 secondes), sinon donne la dernière lecture :
  les puissances, la tranche et les trois index (un index retenu est signalé).
- **Accepter l'index retenu**, en deux clics. Le premier clic liste les index
  retenus et ne prend rien. Le second, de quelques secondes à 5 minutes plus
  tard, prend ce que le premier a listé, pour chaque index dont la valeur
  retenue n'a pas changé depuis (au-delà de ce qui a pu passer entre-temps).
  Un saut est compté d'un coup ; une baisse ne compte rien.

## En cas de problème

- **Injoignable, pas de réponse, mauvaise réponse** : nouvel essai après 30
  secondes, puis doublé jusqu'à 10 minutes. Une requête sans réponse sous 5
  secondes ferme la connexion (une réponse tardive n'est jamais prise pour
  une autre).
- **L'Alfa refuse certains registres** (une exception Modbus sur la tranche,
  l'avis de coupure ou la production) : ces valeurs ne sont pas lues, les
  autres continuent, et l'état dit lesquelles. Un refus des registres du
  réseau (2 à 19) fait échouer la lecture.
- **La configuration ne peut pas être lue depuis Gladys** à une
  (re)connexion : nouvel essai après 5 secondes, doublé jusqu'à 5 minutes,
  l'état le dit ; pendant ce temps les lectures continuent avec la dernière
  configuration reçue, s'il y en a une.
- **Le fichier d'état dans `/data` est illisible** : il est laissé tel quel
  (jamais écrasé) et l'état le dit ; un index retenu peut alors être oublié.

## Vie privée

Tout reste sur votre réseau. L'intégration ne se connecte qu'à l'adresse que
vous avez saisie, sur le port Modbus TCP.
