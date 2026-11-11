<?php
/**
 * Mbayoumkeur – Outil « Doublons de plantes » (chargé par ../mbayoumkeur-agriculteurs.php), réservé à l'administrateur.
 *
 * Repère les plantes qui portent le même nom (comparé sans accents, majuscules ni pluriel) dans la même catégorie, tous
 * producteurs confondus. Rien n'est jamais supprimé automatiquement : l'administrateur choisit la plante à garder, les
 * champs vides de celle-ci sont complétés avec ceux des autres (description, nom local, photos…), puis les autres vont
 * à la CORBEILLE, d'où elles se restaurent. « Ce ne sont pas des doublons » écarte un groupe (deux variétés distinctes).
 *
 * Outils › Doublons de plantes. Un bandeau sur la liste des plantes signale les groupes à traiter.
 */
if (!defined('ABSPATH')) exit;
if (!defined('MBK_CPT')) return;

defined('MBK_GAL') || define('MBK_GAL', 'mbk_galerie');
const MBK_DUP_IGNORED = 'mbk_doublons_ignores';
const MBK_DUP_GAL_MAX = 4; // photos supplémentaires : la principale + 4

/** Forme comparable d'un nom (même règle que l'API de l'application : sans accents, majuscules, ponctuation ni pluriel simple). */
function mbk_dup_norm(string $s): string {
  $s = strtolower(remove_accents(html_entity_decode($s, ENT_QUOTES, 'UTF-8')));
  $s = trim(preg_replace('/[^a-z0-9]+/', ' ', $s));
  if ($s === '') return '';
  return implode(' ', array_map(function ($w) { return strlen($w) > 3 ? preg_replace('/[sx]$/', '', $w) : $w; }, preg_split('/\s+/', $s)));
}

function mbk_dup_key(WP_Post $p): string {
  $n = mbk_dup_norm(get_the_title($p));
  return $n === '' ? '' : $n . '|' . (string) get_post_meta($p->ID, 'categorie_univers', true);
}

/** Groupes de doublons possibles : [clé => [WP_Post, …]], sans les groupes écartés par l'administrateur. */
function mbk_dup_groups(): array {
  $groups = [];
  foreach (get_posts(['post_type' => MBK_CPT, 'post_status' => ['publish', 'draft', 'pending', 'private'], 'posts_per_page' => -1, 'orderby' => 'ID', 'order' => 'ASC']) as $p) {
    $k = mbk_dup_key($p);
    if ($k !== '') $groups[$k][] = $p;
  }
  $ignored = (array) get_option(MBK_DUP_IGNORED, []);
  $out = [];
  foreach ($groups as $k => $g) if (count($g) > 1 && !in_array(md5($k), $ignored, true)) $out[$k] = $g;
  return $out;
}

/** Plus le score est élevé, plus la plante mérite d'être gardée : publiée, avec photo, bien décrite, avec galerie. */
function mbk_dup_score(WP_Post $p): int {
  $gal = array_filter(array_map('intval', (array) get_post_meta($p->ID, MBK_GAL, true)));
  return ($p->post_status === 'publish' ? 100 : 0) + (get_post_thumbnail_id($p->ID) ? 50 : 0) + min(40, (int) (strlen(trim(wp_strip_all_tags($p->post_content))) / 10))
    + 5 * count($gal) + (trim((string) get_post_meta($p->ID, 'nom_local', true)) !== '' ? 5 : 0);
}

/** La plante conseillée : meilleur score ; à égalité, la plus ancienne. */
function mbk_dup_best(array $posts): WP_Post {
  usort($posts, function ($a, $b) { return mbk_dup_score($b) <=> mbk_dup_score($a) ?: $a->ID <=> $b->ID; });
  return $posts[0];
}

/** Garde $keep_id : complète ses champs vides avec ceux des autres, puis met les autres à la corbeille. Retourne le nombre mis à la corbeille. */
function mbk_dup_resolve(int $keep_id, array $ids): int {
  $keep = get_post($keep_id);
  if (!$keep || $keep->post_type !== MBK_CPT) return 0;
  $n = 0;
  foreach (array_unique(array_map('intval', $ids)) as $oid) {
    if ($oid === $keep_id) continue;
    $o = get_post($oid);
    if (!$o || $o->post_type !== MBK_CPT) continue;
    if (trim(wp_strip_all_tags($keep->post_content)) === '' && trim(wp_strip_all_tags($o->post_content)) !== '') {
      wp_update_post(['ID' => $keep_id, 'post_content' => $o->post_content]);
      $keep = get_post($keep_id);
    }
    foreach (['nom_local', 'conseils_entretien', 'prix_unitaire', 'conditionnement'] as $k) {
      $mine = get_post_meta($keep_id, $k, true);
      $theirs = get_post_meta($oid, $k, true);
      if (($mine === '' || $mine === '0' || $mine === 0) && $theirs !== '' && $theirs !== '0' && $theirs !== 0) update_post_meta($keep_id, $k, $theirs);
    }
    if (!get_post_thumbnail_id($keep_id) && get_post_thumbnail_id($oid)) set_post_thumbnail($keep_id, get_post_thumbnail_id($oid));
    $gal = array_values(array_filter(array_map('intval', (array) get_post_meta($keep_id, MBK_GAL, true))));
    foreach (array_merge((array) get_post_meta($oid, MBK_GAL, true), [get_post_thumbnail_id($oid)]) as $a) {
      $a = (int) $a;
      if (!$a || $a === (int) get_post_thumbnail_id($keep_id) || in_array($a, $gal, true)) continue;
      if (count($gal) >= MBK_DUP_GAL_MAX) break;
      $gal[] = $a;
    }
    update_post_meta($keep_id, MBK_GAL, $gal);
    wp_trash_post($oid);
    $n++;
  }
  return $n;
}

/* ------------------------------------------------------------------ */
/* Actions de l'administrateur                                          */
/* ------------------------------------------------------------------ */
add_action('admin_post_mbk_dup_resolve', function () {
  if (!current_user_can('manage_options')) wp_die('Non autorisé.', '', ['response' => 403]);
  check_admin_referer('mbk_dup');
  $keep = (int) ($_POST['keep'] ?? 0);
  $ids = array_map('intval', (array) ($_POST['ids'] ?? []));
  $n = ($keep && in_array($keep, $ids, true)) ? mbk_dup_resolve($keep, $ids) : 0;
  wp_safe_redirect(add_query_arg(['page' => 'mbk-doublons', 'fait' => $n], admin_url('tools.php')));
  exit;
});
add_action('admin_post_mbk_dup_ignore', function () {
  if (!current_user_can('manage_options')) wp_die('Non autorisé.', '', ['response' => 403]);
  check_admin_referer('mbk_dup');
  $ignored = (array) get_option(MBK_DUP_IGNORED, []);
  $ignored[] = md5((string) wp_unslash($_POST['cle'] ?? ''));
  update_option(MBK_DUP_IGNORED, array_values(array_unique($ignored)), false);
  wp_safe_redirect(add_query_arg(['page' => 'mbk-doublons', 'ecarte' => 1], admin_url('tools.php')));
  exit;
});

/* ------------------------------------------------------------------ */
/* Page « Outils › Doublons de plantes » et bandeau sur la liste        */
/* ------------------------------------------------------------------ */
add_action('admin_menu', function () {
  add_management_page('Doublons de plantes', 'Doublons de plantes', 'manage_options', 'mbk-doublons', 'mbk_dup_page');
});

add_action('admin_notices', function () {
  if (!current_user_can('manage_options') || !function_exists('get_current_screen')) return;
  $screen = get_current_screen();
  if (!$screen || $screen->id !== 'edit-' . MBK_CPT) return;
  $n = count(mbk_dup_groups());
  if ($n) echo '<div class="notice notice-warning"><p><strong>' . (int) $n . '</strong> groupe(s) de plantes possiblement en double. <a href="' . esc_url(admin_url('tools.php?page=mbk-doublons')) . '">Les examiner</a></p></div>';
});

function mbk_dup_producer(WP_Post $p): string {
  $name = (string) get_user_meta($p->post_author, 'mbk_exploitation', true);
  if ($name === '') { $u = get_userdata($p->post_author); $name = $u ? $u->display_name : 'inconnu'; }
  return $name;
}

function mbk_dup_page() {
  if (!current_user_can('manage_options')) return;
  $groups = mbk_dup_groups();
  echo '<div class="wrap"><h1>Doublons de plantes</h1>';
  if (isset($_GET['fait'])) echo '<div class="notice notice-success is-dismissible"><p>' . (int) $_GET['fait'] . ' plante(s) mise(s) à la corbeille (elles se restaurent depuis la Corbeille).</p></div>';
  if (isset($_GET['ecarte'])) echo '<div class="notice notice-info is-dismissible"><p>Groupe écarté : il ne sera plus signalé.</p></div>';
  echo '<p>Plantes de même nom (sans tenir compte des accents, des majuscules ni du pluriel) dans la même catégorie, tous producteurs confondus. '
     . 'Rien n’est supprimé automatiquement : choisissez la plante à garder ; ses champs vides sont complétés avec ceux des autres, puis les autres vont à la <strong>Corbeille</strong>.</p>';
  if (!$groups) { echo '<p><strong>Aucun doublon détecté.</strong></p></div>'; return; }
  foreach ($groups as $key => $posts) {
    $best = mbk_dup_best($posts);
    echo '<div class="card" style="max-width:none;margin-top:16px"><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    echo '<input type="hidden" name="action" value="mbk_dup_resolve">'; wp_nonce_field('mbk_dup');
    echo '<table class="widefat striped"><thead><tr><th>Garder</th><th></th><th>Plante</th><th>Producteur</th><th>État</th><th>Date</th><th>Photos</th></tr></thead><tbody>';
    foreach ($posts as $p) {
      $gal = count(array_filter(array_map('intval', (array) get_post_meta($p->ID, MBK_GAL, true))));
      $photos = (get_post_thumbnail_id($p->ID) ? 1 : 0) + $gal;
      $thumb = get_the_post_thumbnail_url($p->ID, 'thumbnail');
      echo '<tr><td><input type="radio" name="keep" value="' . (int) $p->ID . '"' . ($p->ID === $best->ID ? ' checked' : '') . '><input type="hidden" name="ids[]" value="' . (int) $p->ID . '"></td>';
      echo '<td>' . ($thumb ? '<img src="' . esc_url($thumb) . '" alt="" width="56" height="56" style="object-fit:cover;border-radius:6px">' : '—') . '</td>';
      echo '<td><a href="' . esc_url((string) get_edit_post_link($p->ID)) . '"><strong>' . esc_html(get_the_title($p)) . '</strong></a>' . ($p->ID === $best->ID ? ' <em>(conseillée)</em>' : '') . '</td>';
      echo '<td>' . esc_html(mbk_dup_producer($p)) . '</td><td>' . esc_html($p->post_status === 'publish' ? 'En ligne' : 'Brouillon') . '</td>';
      echo '<td>' . esc_html(mysql2date('d/m/Y', $p->post_date)) . '</td><td>' . (int) $photos . '</td></tr>';
    }
    echo '</tbody></table><p><button class="button button-primary">Garder la plante cochée, mettre les autres à la corbeille</button></p></form>';
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '"><input type="hidden" name="action" value="mbk_dup_ignore"><input type="hidden" name="cle" value="' . esc_attr($key) . '">';
    wp_nonce_field('mbk_dup'); echo '<button class="button">Ce ne sont pas des doublons</button></form></div>';
  }
  echo '</div>';
}
