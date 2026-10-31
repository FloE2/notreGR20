# Notre GR20 · site privé

Carte du GR20 étape par étape, photos, carnet de route, profil altimétrique, diaporama et livre photo.
Réservé à deux comptes Google. Tout se fait **depuis le navigateur, sans rien installer**.

```
public/            le site (c'est tout ce qui est publié)
  index.html
  css/style.css
  js/config.js     ← le seul fichier à modifier
  js/…             le reste du code
firestore.rules    ← règles de sécurité (à coller dans la console Firebase)
firebase.json      réglages de l'hébergement
.github/workflows/deploy.yml   publication automatique
```

---

## 1. Créer le projet Firebase (10 min)

1. Va sur <https://console.firebase.google.com> → **Créer un projet** → nom : `notre-gr20` (Google Analytics : inutile, décoche).
2. Le projet reste sur le forfait gratuit **Spark** : ne passe jamais en « Blaze ».
3. **Authentication** → *Commencer* → onglet *Sign-in method* → **Google** → Activer → Enregistrer.
4. **Firestore Database** → *Créer une base de données* → identifiant `(default)` → emplacement **europe-west9 (Paris)** → *mode production* → Créer.
5. Toujours dans Firestore, onglet **Règles** : remplace tout le texte par le contenu du fichier `firestore.rules`,
   **en mettant vos deux adresses Gmail**, puis *Publier*.
6. *(Facultatif, fait gagner un peu de place)* Firestore → **Index** → *Champ unique* → *Ajouter une exception* :
   collection `photos`, champ `d`, désactive tous les index ; refais pareil pour la collection `miniatures`.

## 2. Récupérer la configuration du site

1. Roue dentée ⚙ → **Paramètres du projet** → en bas, *Vos applications* → icône **`</>`** (Web) → nom `site` → *Enregistrer* (ne coche pas « Firebase Hosting », on s'en occupe après).
2. Firebase affiche un bloc `const firebaseConfig = { apiKey: "…", … }`.
3. Ouvre `public/js/config.js`, remplace les `A_REMPLIR` par ces valeurs, et mets vos deux adresses Gmail dans `emailsAutorises`.

> Ces valeurs ne sont pas secrètes : la protection vient des règles Firestore et de la liste des deux adresses.

## 3. Mettre le code sur GitHub

1. Sur GitHub : **New repository** → nom `notre-gr20` → **Private** → Create.
2. *uploading an existing file* → glisse **tout le contenu** du dossier (y compris le dossier `.github`).
   Si le navigateur ne prend pas `.github`, crée le fichier à la main : *Add file → Create new file* → nom
   `.github/workflows/deploy.yml` → colle le contenu du fichier.
3. *Commit changes*.

## 4. Publication automatique GitHub → Firebase (une seule fois)

GitHub doit avoir le droit de publier sur Firebase. On lui donne une « clé de compte de service » :

1. Va sur <https://console.cloud.google.com/iam-admin/serviceaccounts> et choisis le projet `notre-gr20` en haut.
2. **Créer un compte de service** → nom `github-publication` → *Créer et continuer* → ajoute les rôles :
   **Administrateur Firebase Hosting**, **Lecteur de clés API**, **Lecteur Cloud Run** → *OK*.
3. Clique sur le compte créé → onglet **Clés** → *Ajouter une clé* → *Créer une clé* → **JSON** : un fichier se télécharge.
4. Sur GitHub, dans le dépôt : **Settings → Secrets and variables → Actions → New repository secret** :
   - `FIREBASE_SERVICE_ACCOUNT` → colle **tout le contenu** du fichier JSON ;
   - `FIREBASE_PROJECT_ID` → l'identifiant du projet (ex. `notre-gr20` ou `notre-gr20-1a2b3`, visible dans les paramètres Firebase).
5. Supprime ensuite le fichier JSON de ton ordinateur.
6. Onglet **Actions** du dépôt → *Publier le site* → **Run workflow**. Au bout d'une minute, le site est en ligne sur
   `https://<identifiant-du-projet>.web.app`.

Chaque modification d'un fichier sur GitHub republie le site automatiquement.

## 5. Premiers pas sur le site

1. Ouvre `https://<identifiant-du-projet>.web.app`, connecte-toi avec Google.
2. **⚙ Gérer → Construire le tracé** : le site récupère le GR20 sur OpenStreetMap (avec la variante alpine de Bavella et le crochet par Tattone), puis les altitudes IGN. Une minute environ, à faire une seule fois.
   Si une étape n'est pas juste, remplace-la par un fichier GPX (Visorando, Komoot…) depuis la même fenêtre.
3. **⚙ Gérer → Importer** : choisis le ZIP exporté par la trieuse.

## Au fil du tri

- Trieuse : ajoute des favorites → **Exporter la sélection** → site : **⚙ Gérer → Importer**. Seules les nouveautés sont envoyées.
- Une photo ne te plaît plus : **🗑 Retirer du site** (elle ne reviendra pas aux imports suivants), ou retire son étoile dans la trieuse : à l'import, le site proposera de la retirer.
- La **jauge** (en haut à droite et dans ⚙ Gérer) indique l'espace utilisé sur le 1 Go gratuit et le nombre de photos que l'on peut encore ajouter.

## Livre photo

- **📖 Livre photo** : cliquez sur les photos à mettre dans le livre (à deux, chacun de son côté), choisissez le format, puis **Générer le PDF**.
- Les photos du site font 2000 px : parfait jusqu'à ~20 × 20 cm. Pour un grand format, **Liste pour la version haute définition**
  → ouvre ce fichier dans la trieuse (bouton **📖 Livre HD**, après avoir ouvert le dossier des originaux) : elle crée un ZIP des originaux dans l'ordre du livre.

## Limites gratuites (forfait Spark)

| | Gratuit | Pour nous |
|---|---|---|
| Stockage Firestore | 1 Go | ~1 300 photos (≈ 0,7 Mo chacune) |
| Lectures | 50 000 / jour | largement suffisant (le navigateur garde en mémoire les photos déjà vues) |
| Écritures | 20 000 / jour | un import de 500 photos ≈ 1 500 écritures |
| Transfert sortant | 10 Go / mois | ~15 visionnages complets par mois ; au-delà, Firestore se met en pause jusqu'au mois suivant, sans frais |
| Hébergement | 10 Go, 360 Mo/jour | le site pèse moins de 1 Mo |
