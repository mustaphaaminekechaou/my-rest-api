# my-rest-api

API REST (Node.js / Express / PostgreSQL) conteneurisée avec Docker, déployée sur Kubernetes (Minikube) et automatisée avec GitHub Actions (tests, build, déploiement, notification).

## Sommaire

1. [Ce que contient le projet](#1-ce-que-contient-le-projet)
2. [Architecture](#2-architecture)
3. [Prérequis](#3-prérequis)
4. [Lancer l'API en local](#4-lancer-lapi-en-local)
5. [Lancer les tests](#5-lancer-les-tests)
6. [Docker](#6-docker)
7. [Déploiement manuel sur Minikube](#7-déploiement-manuel-sur-minikube)
8. [Accéder à l'API](#8-accéder-à-lapi)
9. [CI/CD avec GitHub Actions](#9-cicd-avec-github-actions)
10. [Runner auto-hébergé](#10-runner-auto-hébergé)
11. [Vérifier un déploiement](#11-vérifier-un-déploiement)
12. [Dépannage](#12-dépannage)

---

## 1. Ce que contient le projet

```
my-rest-api/
├── .github/
│   └── workflows/
│       └── ci-cd.yml            # Pipeline GitHub Actions
├── k8s/                         # Manifestes Kubernetes
│   ├── configmap.yaml           # Configuration non sensible (DB_HOST, DB_PORT...)
│   ├── postgres-pvc.yaml        # Volume de stockage pour Postgres
│   ├── postgres-deployment.yaml # Postgres + son Service
│   ├── deployment.yaml          # API (3 réplicas)
│   ├── service.yaml             # Service de l'API (ClusterIP)
│   └── ingress.yaml             # Routage HTTP api.local -> API
├── tests/
│   └── api.test.js              # Tests Jest + Supertest
├── .gitignore
├── Dockerfile
├── package.json
├── package-lock.json
└── server.js                    # Application Express
```

### Routes de l'API

| Méthode | URL | Action |
|---|---|---|
| GET | `/api/users` | Lister les utilisateurs |
| GET | `/api/users/:id` | Lire un utilisateur |
| POST | `/api/users` | Créer un utilisateur |
| PUT | `/api/users/:id` | Modifier un utilisateur |
| DELETE | `/api/users/:id` | Supprimer un utilisateur |

### Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `DB_HOST` | `localhost` | Hôte Postgres |
| `DB_PORT` | `5432` | Port Postgres |
| `DB_NAME` | `mydb` | Nom de la base |
| `DB_USER` | `postgres` | Utilisateur |
| `DB_PASSWORD` | `postgres` | Mot de passe |

Dans Kubernetes, `DB_HOST/PORT/NAME/USER` viennent du ConfigMap `app-config`, et `DB_PASSWORD` vient du Secret `db-secret`.

## 2. Architecture

```
git push (main)
     │
     ▼
GitHub Actions
 ├─ test    (serveur GitHub, Postgres temporaire)
 ├─ build   (serveur GitHub) ──► image my-rest-api sur Docker Hub
 ├─ deploy  (runner auto-hébergé sur ton PC) ──► kubectl ──► Minikube
 └─ notify  (serveur GitHub, résumé du pipeline)

Minikube (namespace "production")
 Client ──► Ingress (NGINX) ──► Service rest-api ──► 3 pods API
                                                        │
                                       Service postgres-service
                                                        │
                                              Pod Postgres ──► Volume (PVC)
```

## 3. Prérequis

- Docker Desktop (avec l'intégration WSL 2 si tu travailles sous Windows)
- Node.js 18+
- `kubectl`
- Minikube
- Un compte GitHub et un compte Docker Hub

## 4. Lancer l'API en local

Démarre une base Postgres :

```bash
docker run -d --name pg-test -p 5432:5432 \
  -e POSTGRES_DB=mydb -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  postgres:15-alpine
```

Puis l'API :

```bash
npm install
npm start
```

Test rapide :

```bash
curl http://localhost:3000/api/users
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com"}'
```

## 5. Lancer les tests

Les tests utilisent une **vraie** base Postgres (pas de mock) : le conteneur `pg-test` ci-dessus doit tourner.

```bash
npm test
```

Résultat attendu : `4 passed`.

Ce que testent les 4 tests :

- `GET /api/users` renvoie 200 et un tableau ;
- `POST /api/users` renvoie 201 avec un `id` ;
- `GET /api/users/:id` renvoie 200 pour un utilisateur existant ;
- `GET /api/users/9999999` renvoie 404.

Pour que `server.js` soit importable par les tests sans démarrer le serveur, la fin du fichier contient :

```javascript
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
module.exports.pool = pool;
```

Nettoyage :

```bash
docker rm -f pg-test
```

## 6. Docker

Construire et lancer l'image :

```bash
docker build -t my-rest-api:latest .
docker run -d -p 3000:3000 --name api my-rest-api:latest
```

Points clés du `Dockerfile` :

- seuls `package*.json` sont copiés avant `npm ci`, pour profiter du cache Docker ;
- `node_modules` n'est **pas** copié depuis ton PC (il est exclu par `.dockerignore`) : il est recréé dans l'image avec `npm ci` ;
- l'application tourne avec l'utilisateur non-root `node`.

Fichier `.dockerignore` recommandé :

```
node_modules
npm-debug.log
.git
.env
```

## 7. Déploiement manuel sur Minikube

Démarrer le cluster :

```bash
minikube start --driver=docker
kubectl get nodes          # doit afficher "Ready"
minikube addons enable ingress
```

Créer le namespace et le Secret :

```bash
kubectl create namespace production
kubectl create secret generic db-secret \
  --from-literal=password='CHANGE_MOI' \
  -n production
```

Charger l'image locale dans Minikube (si tu n'utilises pas Docker Hub) :

```bash
minikube image load my-rest-api:latest
```

Appliquer les manifestes dans l'ordre :

```bash
kubectl apply -f k8s/configmap.yaml -n production
kubectl apply -f k8s/postgres-pvc.yaml -n production
kubectl apply -f k8s/postgres-deployment.yaml -n production
kubectl apply -f k8s/deployment.yaml -n production
kubectl apply -f k8s/service.yaml -n production
kubectl apply -f k8s/ingress.yaml -n production
```

> `k8s/deployment.yaml` contient `image: IMAGE_PLACEHOLDER`, remplacé par le pipeline. Pour un déploiement manuel, remplace-le par ton image (par exemple `ton-user/my-rest-api:latest`).

Vérifier :

```bash
kubectl get pods -n production
kubectl get svc,ingress,pvc -n production
```

## 8. Accéder à l'API

### Option A : port-forward (le plus simple)

```bash
kubectl port-forward -n production svc/rest-api-service 8080:80
```

Dans un autre terminal :

```bash
curl http://localhost:8080/api/users
```

### Option B : Ingress (`api.local`)

1. Ajouter le nom dans `/etc/hosts` (WSL/Linux) :

   ```bash
   echo "127.0.0.1 api.local" | sudo tee -a /etc/hosts
   ```

   Pour un navigateur Windows : même ligne dans `C:\Windows\System32\drivers\etc\hosts` (en administrateur).

2. Ouvrir le tunnel (terminal dédié, à laisser ouvert) :

   ```bash
   sudo -v
   minikube tunnel
   ```

3. Tester :

   ```bash
   curl --max-time 5 http://api.local/api/users
   ```

Avec le driver Docker, n'utilise **pas** `minikube ip` dans le fichier hosts : cette IP n'est pas joignable depuis ton poste.

## 9. CI/CD avec GitHub Actions

Le workflow est dans `.github/workflows/ci-cd.yml` et se déclenche à chaque `push` sur `main`.

| Job | Où il tourne | Rôle |
|---|---|---|
| `test` | Serveur GitHub | Installe les dépendances, lance lint et tests avec un Postgres temporaire |
| `build` | Serveur GitHub | Construit l'image et la pousse sur Docker Hub (tags `latest` et SHA du commit) |
| `deploy` | Runner auto-hébergé | Crée le namespace et le Secret, injecte l'image, applique les YAML, attend le rollout |
| `notify` | Serveur GitHub | Affiche le résultat de chaque job, échoue si le déploiement a échoué |

Chaque job dépend du précédent : si `test` échoue, rien n'est construit ni déployé.

### Secrets GitHub à créer

Dans **ton dépôt** : *Settings → Secrets and variables → Actions → New repository secret*.

| Nom | Valeur |
|---|---|
| `DOCKERHUB_USERNAME` | Identifiant Docker Hub |
| `DOCKERHUB_TOKEN` | Token Docker Hub (*Account settings → Personal access tokens*, droits Read & Write) |
| `DB_PASSWORD` | Mot de passe de la base dans le cluster |

Ne mets jamais ces valeurs dans le code ni dans un fichier commité. Le Secret Kubernetes `db-secret` est créé par le pipeline : il n'y a donc **pas** de `secret.yaml` dans le dépôt.

### Ce que fait le job `deploy`

1. `kubectl create namespace production --dry-run=client -o yaml | kubectl apply -f -` : crée le namespace s'il n'existe pas.
2. Crée ou met à jour le Secret `db-secret` à partir de `DB_PASSWORD`.
3. Remplace `IMAGE_PLACEHOLDER` dans `k8s/deployment.yaml` par `utilisateur/my-rest-api:<sha>`.
4. Applique ConfigMap, PVC, Postgres, API, Service et Ingress.
5. `kubectl rollout status` : attend la fin du déploiement, et échoue si les pods ne démarrent pas.

### Premier lancement

```bash
git add .
git commit -m "Add CI/CD pipeline"
git push
```

Puis ouvre l'onglet **Actions** du dépôt. Pour relancer uniquement le job en échec : *Re-run failed jobs*.

## 10. Runner auto-hébergé

### Pourquoi un runner ?

GitHub est sur internet et ne peut pas atteindre ton Minikube local. Le **runner** est un petit programme installé sur ton PC qui écoute GitHub. Quand `deploy` démarre, GitHub lui envoie les commandes et il les exécute chez toi, avec ton `kubectl` et ton `~/.kube/config`.

```
GitHub ──► Runner (ton Ubuntu/WSL) ──► kubectl ──► Minikube
```

Le workflow l'utilise grâce à la ligne `runs-on: self-hosted`. Seul `deploy` en a besoin.

### Installation

1. Dans le dépôt : *Settings → Actions → Runners → New self-hosted runner → Linux x64*.
2. Copie les commandes affichées dans ton Ubuntu (le token est temporaire et propre à ton dépôt).
3. Installe-le **en dehors** du dossier du projet (par exemple `~/actions-runner`), pour ne jamais le versionner par erreur.
4. Lance-le :

   ```bash
   cd ~/actions-runner
   ./run.sh
   ```

   Tu dois voir `Listening for Jobs`. Laisse ce terminal ouvert.

Si le dossier du runner se trouve dans le projet, ajoute `actions-runner/` au `.gitignore` : il contient des identifiants.

### Checklist avant chaque push

```bash
minikube status                    # Running
kubectl get nodes                  # Ready
cd ~/actions-runner && ./run.sh    # Listening for Jobs
```

Lance le runner depuis le terminal où `kubectl get nodes` fonctionne (même utilisateur, donc même configuration Minikube).

### Cluster dans le cloud

Si tu utilises un vrai cluster accessible depuis internet, le runner n'est plus nécessaire : remplace `runs-on: self-hosted` par `ubuntu-latest` et ajoute avant les commandes `kubectl` :

```yaml
- uses: azure/k8s-set-context@v4
  with:
    method: kubeconfig
    kubeconfig: ${{ secrets.KUBE_CONFIG }}
```

## 11. Vérifier un déploiement

```bash
# Pods, services, ingress, volume
kubectl get pods -n production
kubectl get svc,ingress,pvc -n production

# Image réellement déployée (doit afficher le SHA du dernier commit)
kubectl get deployment rest-api-deployment -n production \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
git log --oneline -1

# Logs de l'API
kubectl logs deploy/rest-api-deployment -n production --tail=20

# Test de l'API
kubectl port-forward -n production svc/rest-api-service 8080:80
curl http://localhost:8080/api/users
```

Preuve de bout en bout : fais un petit changement dans `server.js`, `git push`, et vérifie que les 4 jobs passent au vert et que l'image du déploiement prend le nouveau SHA.

## 12. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `connection refused` sur `127.0.0.1:<port>` | Minikube arrêté | `minikube start`, puis *Re-run failed jobs* |
| `deploy` reste en attente (*Waiting for a runner*) | Runner non lancé | `./run.sh` dans le dossier du runner |
| `ErrImageNeverPull` | `imagePullPolicy: Never` ou image absente de Minikube | Retirer `imagePullPolicy: Never` ; image venant de Docker Hub |
| `ErrImagePull` | Dépôt Docker Hub privé | Le rendre public |
| `relation "users" does not exist` | L'API a démarré avant Postgres | `kubectl rollout restart deployment rest-api-deployment -n production` |
| `npm ci` échoue (lock désynchronisé) | `package-lock.json` ne correspond pas à `package.json` | `rm -rf node_modules package-lock.json && npm install`, puis commit |
| PVC `field can not be less than status.capacity` | Taille du fichier inférieure à celle du volume existant | Mettre une taille égale ou supérieure, ou supprimer le PVC |
| Ingress refusé : `host "api.local" and path "/" is already defined` | Ancien Ingress dans un autre namespace | `kubectl delete ingress rest-api-ingress -n default` |
| `curl api.local` bloque ou `reset by peer` | Tunnel non lancé ou mauvaise IP dans `hosts` | `127.0.0.1 api.local` + `minikube tunnel`, ou utiliser `port-forward` |
| `503` via l'Ingress | Aucun pod prêt | `kubectl get endpoints rest-api-service -n production` |
| `docker-credential-desktop.exe: exec format error` | `credsStore` dans `~/.docker/config.json` | Mettre le fichier à `{}` |
| `Could not resolve host: github.com` (WSL) | DNS de WSL | `wsl --shutdown` dans PowerShell, désactiver le VPN |
| `src refspec main does not match any` | Aucun commit, ou branche nommée `master` | `git commit`, puis `git branch -M main` |
| `rejected (fetch first)` au push | Le dépôt distant contient déjà des fichiers | `git pull origin main --allow-unrelated-histories --no-rebase` |

## Bonnes pratiques

- Ne commite jamais de mot de passe, token ou fichier `.env`.
- `node_modules/` est dans `.gitignore` et `.dockerignore`.
- Garde `package-lock.json` dans Git : `npm ci` en dépend.
- Applique toujours les manifestes avec `-n production`.
- Un nom de dépôt Docker en minuscules uniquement.
