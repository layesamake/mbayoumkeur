<?php
/**
 * Mbayoumkeur – API de l'application agriculteur (espace de noms « mbk/v1 »).
 *
 *   POST   /mbk/v1/login                      identifiant + mot de passe → mot de passe d'application (limité en essais)
 *   GET    /mbk/v1/config                     catégories et conditionnements proposés
 *   GET    /mbk/v1/plantes                    MES plantes (jamais celles des autres)
 *   POST   /mbk/v1/plantes                    créer (multipart : champs + photo)
 *   POST   /mbk/v1/plantes/{id}               modifier (multipart : champs + photo facultative)
 *   POST   /mbk/v1/plantes/{id}/disponibilite en stock / épuisé
 *   DELETE /mbk/v1/plantes/{id}               retirer (corbeille)
 *
 * Chargé par ../mbayoumkeur-agriculteurs.php après core.php. L'application Node appelle ces routes avec le
 * mot de passe d'application de l'agriculteur : c'est donc bien SON compte WordPress qui écrit (plantes rattachées
 * à lui, e-mail à l'administrateur à la publication, photo obligatoire pour publier, confidentialité conservée).
 */
if (!defined('ABSPATH')) exit;
if (!function_exists('mbk_is_farmer') || !defined('MBK_CPT') || !function_exists('mbk_univers_choices')) return;

const MBK_API_UNITS = ['pot' => 'Pot', 'plant' => 'Plant', 'alveole' => 'Alvéole', 'sachet' => 'Sachet', 'botte' => 'Botte'];
const MBK_API_HIDDEN_UNIVERS = ['terreaux', 'accessoires']; // vendus par la boutique, pas produits par les agriculteurs

/* ------------------------------------------------------------------ */
/* Outils                                                               */
/* ------------------------------------------------------------------ */
function mbk_api_can(): bool {
  return is_user_logged_in() && (mbk_is_farmer() || current_user_can('manage_options'));
}

function mbk_api_get($id, string $key) {
  return function_exists('get_field') ? get_field($key, $id, false) : get_post_meta($id, $key, true);
}

function mbk_api_set($id, string $key, $value): void {
  if (function_exists('update_field')) update_field($key, $value, $id);
  update_post_meta($id, $key, $value); // même clé que celle lue par le site : sûr même si le champ ACF n'est pas encore déclaré
}

function mbk_api_univers(): array {
  return array_diff_key(mbk_univers_choices(), array_flip(MBK_API_HIDDEN_UNIVERS));
}

function mbk_api_own_plant(int $id) {
  $p = get_post($id);
  if (!$p || $p->post_type !== MBK_CPT || $p->post_status === 'trash') return new WP_Error('mbk_introuvable', 'Plante introuvable.', ['status' => 404]);
  if ((int) $p->post_author !== get_current_user_id() && !current_user_can('manage_options')) {
    return new WP_Error('mbk_interdit', 'Cette plante ne vous appartient pas.', ['status' => 403]);
  }
  return $p;
}

function mbk_api_plante(WP_Post $p): array {
  $thumb_id = get_post_thumbnail_id($p);
  $photo = '';
  if ($thumb_id) {
    $photo = wp_get_attachment_image_url($thumb_id, 'mbk-400') ?: wp_get_attachment_image_url($thumb_id, 'medium') ?: (wp_get_attachment_url($thumb_id) ?: '');
  }
  $dispo = mbk_api_get($p->ID, 'disponible');
  return [
    'id' => $p->ID,
    'ref' => 'MK-' . str_pad((string) $p->ID, 4, '0', STR_PAD_LEFT),
    'titre' => html_entity_decode(get_the_title($p), ENT_QUOTES, 'UTF-8'),
    'description' => trim(wp_strip_all_tags($p->post_content)),
    'conseils' => (string) mbk_api_get($p->ID, 'conseils_entretien'),
    'categorie' => (string) mbk_api_get($p->ID, MBK_UNIVERS_META),
    'prix' => (int) mbk_api_get($p->ID, 'prix_unitaire'),
    'conditionnement' => (string) mbk_api_get($p->ID, 'conditionnement'),
    'disponible' => !($dispo === '0' || $dispo === 0 || $dispo === false),
    'statut' => $p->post_status === 'publish' ? 'publish' : 'draft',
    'photo' => $photo,
    'modifie' => get_post_modified_time('c', true, $p),
  ];
}

/** Lit et valide les champs envoyés. Retourne un tableau nettoyé ou WP_Error (message lisible par l'agriculteur). */
function mbk_api_fields(WP_REST_Request $r, bool $partial = false) {
  $out = [];
  $has = fn ($k) => $r->get_param($k) !== null;

  if (!$partial || $has('titre')) {
    $t = trim(sanitize_text_field((string) $r->get_param('titre')));
    if (mb_strlen($t) < 2) return new WP_Error('mbk_champ', 'Indiquez le nom de la plante.', ['status' => 400]);
    $out['titre'] = mb_substr($t, 0, 80);
  }
  if (!$partial || $has('categorie')) {
    $c = (string) $r->get_param('categorie');
    if (!array_key_exists($c, mbk_api_univers())) return new WP_Error('mbk_champ', 'Choisissez une catégorie.', ['status' => 400]);
    $out['categorie'] = $c;
  }
  if ($has('prix')) {
    $p = (string) $r->get_param('prix');
    if ($p !== '' && !ctype_digit($p)) return new WP_Error('mbk_champ', 'Le prix doit être un nombre entier en FCFA.', ['status' => 400]);
    $out['prix'] = min(10000000, (int) $p);
  }
  if ($has('conditionnement')) {
    $u = (string) $r->get_param('conditionnement');
    if ($u !== '' && !isset(MBK_API_UNITS[$u])) return new WP_Error('mbk_champ', 'Conditionnement inconnu.', ['status' => 400]);
    $out['conditionnement'] = $u;
  }
  if ($has('disponible')) $out['disponible'] = in_array((string) $r->get_param('disponible'), ['1', 'true', 'on'], true) ? 1 : 0;
  if ($has('description')) $out['description'] = mb_substr(trim(sanitize_textarea_field((string) $r->get_param('description'))), 0, 1500);
  if ($has('conseils')) $out['conseils'] = mb_substr(trim(sanitize_textarea_field((string) $r->get_param('conseils'))), 0, 1000);
  if ($has('statut')) $out['statut'] = $r->get_param('statut') === 'publish' ? 'publish' : 'draft';
  return $out;
}

function mbk_api_apply(int $id, array $f): void {
  if (array_key_exists('categorie', $f)) mbk_api_set($id, MBK_UNIVERS_META, $f['categorie']);
  if (array_key_exists('prix', $f)) mbk_api_set($id, 'prix_unitaire', $f['prix']);
  if (array_key_exists('conditionnement', $f)) mbk_api_set($id, 'conditionnement', $f['conditionnement']);
  if (array_key_exists('disponible', $f)) mbk_api_set($id, 'disponible', $f['disponible']);
  if (array_key_exists('conseils', $f)) mbk_api_set($id, 'conseils_entretien', $f['conseils']);
}

/** Enregistre la photo envoyée (champ « photo ») comme image à la une. Le filtre d'optimisation s'applique à l'envoi. */
function mbk_api_photo(int $post_id) {
  if (empty($_FILES['photo']) || !empty($_FILES['photo']['error']) && (int) $_FILES['photo']['error'] === UPLOAD_ERR_NO_FILE) return 0;
  require_once ABSPATH . 'wp-admin/includes/file.php';
  require_once ABSPATH . 'wp-admin/includes/media.php';
  require_once ABSPATH . 'wp-admin/includes/image.php';
  $att = media_handle_upload('photo', $post_id);
  if (is_wp_error($att)) return new WP_Error('mbk_photo', 'La photo n’a pas pu être enregistrée : ' . $att->get_error_message(), ['status' => 400]);
  set_post_thumbnail($post_id, $att);
  return (int) $att;
}

/* ------------------------------------------------------------------ */
/* Routes                                                               */
/* ------------------------------------------------------------------ */
add_action('rest_api_init', function () {
  $perm = fn () => mbk_api_can() ?: new WP_Error('mbk_interdit', 'Réservé aux agriculteurs.', ['status' => 403]);

  register_rest_route('mbk/v1', '/login', ['methods' => 'POST', 'callback' => 'mbk_api_login', 'permission_callback' => '__return_true']);
  register_rest_route('mbk/v1', '/config', ['methods' => 'GET', 'callback' => 'mbk_api_config', 'permission_callback' => $perm]);
  register_rest_route('mbk/v1', '/plantes', [
    ['methods' => 'GET', 'callback' => 'mbk_api_list', 'permission_callback' => $perm],
    ['methods' => 'POST', 'callback' => 'mbk_api_create', 'permission_callback' => $perm],
  ]);
  register_rest_route('mbk/v1', '/plantes/(?P<id>\d+)', [
    ['methods' => 'POST', 'callback' => 'mbk_api_update', 'permission_callback' => $perm],
    ['methods' => 'DELETE', 'callback' => 'mbk_api_delete', 'permission_callback' => $perm],
  ]);
  register_rest_route('mbk/v1', '/plantes/(?P<id>\d+)/disponibilite', ['methods' => 'POST', 'callback' => 'mbk_api_stock', 'permission_callback' => $perm]);
});

function mbk_api_login(WP_REST_Request $r) {
  $login = trim((string) $r->get_param('identifiant'));
  $pass = (string) $r->get_param('motdepasse');
  if ($login === '' || $pass === '') return new WP_Error('mbk_identifiants', 'Saisissez votre identifiant et votre mot de passe.', ['status' => 400]);

  // 6 essais par quart d'heure et par identifiant + adresse
  $key = 'mbk_login_' . md5(strtolower($login) . '|' . ($_SERVER['REMOTE_ADDR'] ?? ''));
  $tries = (int) get_transient($key);
  if ($tries >= 6) return new WP_Error('mbk_trop_essais', 'Trop de tentatives. Réessayez dans quelques minutes.', ['status' => 429]);

  $user = wp_authenticate($login, $pass);
  if (is_wp_error($user)) {
    set_transient($key, $tries + 1, 15 * MINUTE_IN_SECONDS);
    return new WP_Error('mbk_identifiants', 'Identifiant ou mot de passe incorrect.', ['status' => 401]);
  }
  if (!in_array(MBK_ROLE, (array) $user->roles, true) && !user_can($user, 'manage_options')) {
    return new WP_Error('mbk_interdit', 'Ce compte n’a pas accès à l’espace agriculteur.', ['status' => 403]);
  }
  delete_transient($key);

  if (!class_exists('WP_Application_Passwords') || !wp_is_application_passwords_available_for_user($user)) {
    return new WP_Error('mbk_serveur', 'Connexion sécurisée indisponible sur ce serveur (HTTPS requis).', ['status' => 500]);
  }
  // une session par téléphone : on garde les 4 plus récentes, les anciennes sont révoquées
  $mine = array_values(array_filter(WP_Application_Passwords::get_user_application_passwords($user->ID), fn ($a) => strpos($a['name'], 'Application agriculteur') === 0));
  usort($mine, fn ($a, $b) => $b['created'] <=> $a['created']);
  foreach (array_slice($mine, 3) as $old) WP_Application_Passwords::delete_application_password($user->ID, $old['uuid']);

  $created = WP_Application_Passwords::create_new_application_password($user->ID, ['name' => 'Application agriculteur ' . wp_date('d/m/Y H:i')]);
  if (is_wp_error($created)) return new WP_Error('mbk_serveur', 'Création de la session impossible.', ['status' => 500]);

  return ['id' => $user->ID, 'identifiant' => $user->user_login, 'motdepasse_application' => $created[0], 'nom' => $user->first_name ?: $user->display_name];
}

function mbk_api_config() {
  $univers = [];
  foreach (mbk_api_univers() as $slug => $label) $univers[] = ['slug' => $slug, 'label' => $label, 'icone' => mbk_univers_icon($slug)];
  $units = [];
  foreach (MBK_API_UNITS as $v => $l) $units[] = ['valeur' => $v, 'label' => $l];
  return ['univers' => $univers, 'conditionnements' => $units];
}

function mbk_api_list() {
  $posts = get_posts([
    'post_type' => MBK_CPT, 'author' => get_current_user_id(), 'post_status' => ['publish', 'draft', 'pending', 'private'],
    'posts_per_page' => 200, 'orderby' => 'modified', 'order' => 'DESC',
  ]);
  return ['plantes' => array_map('mbk_api_plante', $posts)];
}

function mbk_api_create(WP_REST_Request $r) {
  $f = mbk_api_fields($r);
  if (is_wp_error($f)) return $f;
  $status = $f['statut'] ?? 'draft';
  $has_file = !empty($_FILES['photo']) && (int) ($_FILES['photo']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
  if ($status === 'publish' && !$has_file) return new WP_Error('mbk_photo', 'Ajoutez une photo de votre plante avant de publier.', ['status' => 400]);

  $id = wp_insert_post(['post_type' => MBK_CPT, 'post_status' => 'draft', 'post_title' => $f['titre'], 'post_content' => $f['description'] ?? '', 'post_author' => get_current_user_id()], true);
  if (is_wp_error($id)) return new WP_Error('mbk_serveur', 'Enregistrement impossible.', ['status' => 500]);

  $photo = mbk_api_photo($id);
  if (is_wp_error($photo)) { wp_delete_post($id, true); return $photo; }
  mbk_api_apply($id, $f);
  if ($status === 'publish') wp_update_post(['ID' => $id, 'post_status' => 'publish']);
  return new WP_REST_Response(mbk_api_plante(get_post($id)), 201);
}

function mbk_api_update(WP_REST_Request $r) {
  $p = mbk_api_own_plant((int) $r['id']);
  if (is_wp_error($p)) return $p;
  $f = mbk_api_fields($r, true);
  if (is_wp_error($f)) return $f;

  $photo = mbk_api_photo($p->ID);
  if (is_wp_error($photo)) return $photo;
  $status = $f['statut'] ?? $p->post_status;
  if ($status === 'publish' && !get_post_thumbnail_id($p)) return new WP_Error('mbk_photo', 'Ajoutez une photo de votre plante avant de publier.', ['status' => 400]);

  $upd = ['ID' => $p->ID];
  if (isset($f['titre'])) $upd['post_title'] = $f['titre'];
  if (array_key_exists('description', $f)) $upd['post_content'] = $f['description'];
  if (isset($f['statut'])) $upd['post_status'] = $f['statut'];
  if (count($upd) > 1) wp_update_post($upd);
  mbk_api_apply($p->ID, $f);
  return mbk_api_plante(get_post($p->ID));
}

function mbk_api_stock(WP_REST_Request $r) {
  $p = mbk_api_own_plant((int) $r['id']);
  if (is_wp_error($p)) return $p;
  mbk_api_set($p->ID, 'disponible', in_array((string) $r->get_param('disponible'), ['1', 'true'], true) ? 1 : 0);
  return mbk_api_plante(get_post($p->ID));
}

function mbk_api_delete(WP_REST_Request $r) {
  $p = mbk_api_own_plant((int) $r['id']);
  if (is_wp_error($p)) return $p;
  wp_trash_post($p->ID);
  return ['supprime' => true];
}
