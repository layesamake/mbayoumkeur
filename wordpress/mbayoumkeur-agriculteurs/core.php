<?php
/**
 * Plugin Name: Mbayoumkeur – Espace agriculteur
 * Description: Rôle « Agriculteur » (publication directe de leurs plantes uniquement, photo obligatoire)
 *              et confidentialité totale des producteurs (aucun nom ni contact public).
 *
 * À copier dans wp-content/mu-plugins/ du WordPress (cms.mbayoumkeur.shop).
 */
if (!defined('ABSPATH')) exit;

const MBK_CPT = 'plante';
const MBK_ROLE = 'agriculteur';

function mbk_is_farmer(): bool {
  $u = wp_get_current_user();
  return $u && $u->exists() && in_array(MBK_ROLE, (array) $u->roles, true);
}

/* ------------------------------------------------------------------ */
/* 1. Rôle « Agriculteur » : crée, modifie et PUBLIE ses propres plantes */
/* ------------------------------------------------------------------ */
const MBK_CAPS = [
  'read', 'upload_files',
  'edit_posts', 'delete_posts', 'publish_posts',           // le type « plante » utilise les droits des articles
  'edit_published_posts', 'delete_published_posts',        // modifier / retirer SES plantes déjà publiées
  // volontairement absents : edit_others_posts, delete_others_posts, moderate_comments, manage_*…
];

add_action('init', function () {
  $role = get_role(MBK_ROLE) ?: add_role(MBK_ROLE, 'Agriculteur', []);
  foreach (MBK_CAPS as $cap) {
    if (!$role->has_cap($cap)) $role->add_cap($cap);
  }
  // Empêche l'énumération des auteurs (?author=1)
  if (!is_admin() && isset($_GET['author'])) {
    wp_safe_redirect(home_url('/'), 301);
    exit;
  }
}, 1);

// Photo obligatoire : pas de publication sans image à la une (photo de sa propre production)
add_filter('rest_pre_insert_' . MBK_CPT, function ($prepared, $request) {
  if (!mbk_is_farmer()) return $prepared;
  $status = $prepared->post_status ?? ($request['status'] ?? '');
  if ($status === 'publish') {
    $thumb = $request->has_param('featured_media')
      ? (int) $request['featured_media']
      : (!empty($prepared->ID) ? (int) get_post_thumbnail_id($prepared->ID) : 0);
    if (!$thumb) {
      return new WP_Error('mbk_photo', 'Ajoutez une photo de votre production (image à la une) avant de publier.', ['status' => 400]);
    }
  }
  return $prepared;
}, 10, 2);

// E-mail à l'administrateur à chaque nouvelle plante publiée par un agriculteur
add_action('transition_post_status', function ($new, $old, $post) {
  if ($post->post_type !== MBK_CPT || $new !== 'publish' || $old === 'publish') return;
  if (!user_can($post->post_author, 'edit_posts') || user_can($post->post_author, 'manage_options')) return;
  $expl = get_user_meta($post->post_author, 'mbk_exploitation', true) ?: 'un agriculteur';
  wp_mail(
    get_option('admin_email'),
    '[Mbayoumkeur] Nouvelle plante publiée : ' . $post->post_title,
    "« {$post->post_title} » vient d'être publiée par {$expl}.

Voir : " .
      admin_url('post.php?post=' . $post->ID . '&action=edit')
  );
}, 10, 3);

/* ------------------------------------------------------------------ */
/* 2. Espace réduit : seulement « Mes plantes » et « Mon profil »       */
/* ------------------------------------------------------------------ */
add_action('admin_menu', function () {
  if (!mbk_is_farmer()) return;
  global $menu;
  foreach ((array) $menu as $item) {
    if (!in_array($item[2], ['edit.php?post_type=' . MBK_CPT, 'profile.php'], true)) remove_menu_page($item[2]);
  }
}, 9999);

add_action('admin_init', function () {
  if (!mbk_is_farmer() || wp_doing_ajax()) return;
  global $pagenow;
  $pt = $_GET['post_type'] ?? '';
  $ok = false;
  if (in_array($pagenow, ['edit.php', 'post-new.php'], true)) $ok = ($pt === MBK_CPT);
  elseif ($pagenow === 'post.php') {
    $id = (int) ($_GET['post'] ?? $_POST['post_ID'] ?? 0);
    $ok = $id && get_post_type($id) === MBK_CPT;
  } else {
    $ok = in_array($pagenow, ['profile.php', 'admin-post.php', 'async-upload.php', 'media-upload.php'], true);
  }
  if (!$ok) {
    wp_safe_redirect(admin_url('edit.php?post_type=' . MBK_CPT));
    exit;
  }
});

add_filter('show_admin_bar', fn ($show) => mbk_is_farmer() ? false : $show);
add_filter('login_redirect', fn ($to, $req, $user) =>
  ($user instanceof WP_User && in_array(MBK_ROLE, (array) $user->roles, true)) ? admin_url('edit.php?post_type=' . MBK_CPT) : $to, 10, 3);

// Écritures REST autorisées pour un agriculteur : plantes, médias, son propre profil
add_filter('rest_pre_dispatch', function ($result, $server, $request) {
  if (!mbk_is_farmer()) return $result;
  if (in_array($request->get_method(), ['POST', 'PUT', 'PATCH', 'DELETE'], true)
      && !preg_match('#^/(wp/v2/(' . MBK_CPT . '|media|users/me)|mbk/v1/plantes)(/|$)#', $request->get_route())) {
    return new WP_Error('mbk_forbidden', 'Action non autorisée.', ['status' => 403]);
  }
  return $result;
}, 10, 3);

/* ------------------------------------------------------------------ */
/* 3. Fiche producteur : visible et modifiable par l'administrateur seul */
/* ------------------------------------------------------------------ */
const MBK_FIELDS = ['mbk_exploitation' => 'Nom de l’exploitation', 'mbk_adresse' => 'Adresse', 'mbk_telephone' => 'Téléphone / WhatsApp'];

function mbk_profile_fields($user) {
  if (!current_user_can('manage_options')) return;
  echo '<h2>Producteur (interne – jamais affiché publiquement)</h2><table class="form-table">';
  foreach (MBK_FIELDS as $key => $label) {
    printf('<tr><th><label for="%1$s">%2$s</label></th><td><input type="text" name="%1$s" id="%1$s" class="regular-text" value="%3$s"></td></tr>',
      esc_attr($key), esc_html($label), esc_attr(get_user_meta($user->ID, $key, true)));
  }
  echo '</table>';
}
add_action('show_user_profile', 'mbk_profile_fields');
add_action('edit_user_profile', 'mbk_profile_fields');

function mbk_save_profile_fields($user_id) {
  if (!current_user_can('manage_options')) return;
  foreach (array_keys(MBK_FIELDS) as $key) {
    if (isset($_POST[$key])) update_user_meta($user_id, $key, sanitize_text_field(wp_unslash($_POST[$key])));
  }
}
add_action('personal_options_update', 'mbk_save_profile_fields');
add_action('edit_user_profile_update', 'mbk_save_profile_fields');

// Création d'un compte par l'API REST (administrateur) : mêmes champs
add_action('rest_insert_user', function ($user, $request) {
  if (!current_user_can('manage_options')) return;
  foreach (array_keys(MBK_FIELDS) as $key) {
    if (null !== $request->get_param($key)) update_user_meta($user->ID, $key, sanitize_text_field($request->get_param($key)));
  }
}, 10, 2);

// Colonnes pour l'administrateur : référence interne + producteur
add_filter('manage_' . MBK_CPT . '_posts_columns', function ($cols) {
  if (mbk_is_farmer()) return $cols;
  $cols['mbk_ref'] = 'Réf.';
  $cols['mbk_producteur'] = 'Producteur';
  return $cols;
});
add_action('manage_' . MBK_CPT . '_posts_custom_column', function ($col, $id) {
  if ($col === 'mbk_ref') echo 'MK-' . str_pad($id, 4, '0', STR_PAD_LEFT);
  if ($col === 'mbk_producteur') {
    $a = get_post_field('post_author', $id);
    $e = get_user_meta($a, 'mbk_exploitation', true);
    $t = get_user_meta($a, 'mbk_telephone', true);
    echo esc_html($e ?: get_the_author_meta('display_name', $a)) . ($t ? ' · ' . esc_html($t) : '');
  }
}, 10, 2);

/* ------------------------------------------------------------------ */
/* 4. Confidentialité : aucune trace d'agriculteur dans l'API publique  */
/* ------------------------------------------------------------------ */
// Plus de liste d'utilisateurs ni de fiche utilisateur (sauf /users/me et administrateurs)
add_filter('rest_endpoints', function ($endpoints) {
  if (!current_user_can('list_users')) {
    unset($endpoints['/wp/v2/users'], $endpoints['/wp/v2/users/(?P<id>[\d]+)']);
  }
  return $endpoints;
});

// Plus d'identifiant d'auteur sur les plantes et les médias
foreach ([MBK_CPT, 'attachment'] as $type) {
  add_filter("rest_prepare_$type", function ($response) {
    if (!current_user_can('list_users')) {
      $data = $response->get_data();
      unset($data['author']);
      $response->set_data($data);
      $response->remove_link('author');
    }
    return $response;
  });
}

// Pas de pages auteur, ni dans le sitemap, ni dans oEmbed
add_action('template_redirect', function () {
  if (is_author()) { wp_safe_redirect(home_url('/'), 301); exit; }
}, 1);
add_filter('author_link', fn () => home_url('/'));
add_filter('wp_sitemaps_add_provider', fn ($provider, $name) => $name === 'users' ? false : $provider, 10, 2);
add_filter('oembed_response_data', function ($data) { unset($data['author_name'], $data['author_url']); return $data; });

// Le type « plante » doit gérer l'auteur (rattachement des plantes à un agriculteur, réservé à l'administrateur)
add_action('init', function () {
  add_post_type_support(MBK_CPT, 'author');
}, 99);
