<?php
/**
 * Mbayoumkeur – habillage du back-office :
 *  - toute référence à WordPress masquée (logo, pied de page, titres, tableau de bord, connexion…)
 *  - couleurs de la marque, icône « feuille », emojis par catégorie
 *  - catégories de plantes (« Catégorie d'univers ») dans le menu de gauche, avec filtre de la liste
 *
 * Chargé par ../mbayoumkeur-agriculteurs.php après core.php.
 */
if (!defined('ABSPATH')) exit;
if (!function_exists('mbk_is_farmer') || !defined('MBK_CPT')) return;

const MBK_UNIVERS_FIELD = 'field_plante_univers';
const MBK_UNIVERS_META = 'categorie_univers';
const MBK_MENU_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PHBhdGggZmlsbD0iI2E3YWFhZCIgZD0iTTE3IDJDOSAyIDMgNiAzIDEyYzAgMS41LjUgMi44IDEuMyAzLjhDNSAxMiA4IDkgMTIgNy41IDguNSA5LjUgNiAxMi41IDUgMTdjLjUuMiAxIC4zIDEuNS4zIDYgMCAxMC41LTUgMTAuNS0xMS41VjJ6Ii8+PC9zdmc+';

/* ------------------------------------------------------------------ */
/* Catégories (champ « Catégorie d'univers »)                           */
/* ------------------------------------------------------------------ */
function mbk_univers_choices(): array {
  if (function_exists('acf_get_field')) {
    $f = acf_get_field(MBK_UNIVERS_FIELD);
    if ($f && !empty($f['choices'])) {
      $c = array_filter((array) $f['choices'], 'strlen');
      if ($c) return $c;
    }
  }
  return [
    'herbes-aromatiques' => 'Herbes aromatiques',
    'plantes-comestibles' => 'Plantes comestibles',
    'arbres-fruitiers' => 'Arbres fruitiers',
    'fleurs' => 'Fleurs',
    'terreaux' => 'Terreaux et substrat',
    'accessoires' => 'Accessoires de jardinage',
    'produits-phyto' => 'Produits phyto',
  ];
}

function mbk_univers_icon(string $slug): string {
  $icons = [
    'herbes-aromatiques' => '🌿',
    'plantes-comestibles' => '🥬',
    'arbres-fruitiers' => '🌳',
    'fleurs' => '🌸',
    'terreaux' => '🌱',
    'accessoires' => '✂️',
    'produits-phyto' => '🧴',
  ];
  return $icons[$slug] ?? '🪴';
}

function mbk_count_univers(string $slug, bool $own_only): int {
  $args = [
    'post_type' => MBK_CPT,
    'post_status' => ['publish', 'draft', 'pending', 'private'],
    'meta_key' => MBK_UNIVERS_META,
    'meta_value' => $slug,
    'posts_per_page' => 1,
    'fields' => 'ids',
  ];
  if ($own_only) $args['author'] = get_current_user_id();
  $q = new WP_Query($args);
  return (int) $q->found_posts;
}

// Menu de gauche : icône feuille + sous-menu par catégorie
add_action('admin_menu', function () {
  global $menu, $submenu;
  $parent = 'edit.php?post_type=' . MBK_CPT;
  $farmer = mbk_is_farmer();

  foreach ((array) $menu as $k => $m) {
    if ($m[2] === $parent) {
      $menu[$k][6] = MBK_MENU_ICON;
      $menu[$k][0] = $farmer ? 'Mes plantes' : 'Plantes';
    }
    if ($farmer && $m[2] === 'profile.php') $menu[$k][0] = 'Mon profil';
  }
  if (empty($submenu[$parent])) return;

  $items = [[$farmer ? 'Toutes mes plantes' : 'Toutes les plantes', 'edit_posts', $parent]];
  foreach (mbk_univers_choices() as $slug => $label) {
    $items[] = [
      mbk_univers_icon($slug) . ' ' . esc_html($label) . ' <span class="mbk-count">' . mbk_count_univers($slug, $farmer) . '</span>',
      'edit_posts',
      $parent . '&mbk_univers=' . $slug,
    ];
  }
  $items[] = [$farmer ? '➕ Ajouter une plante' : '➕ Ajouter', 'edit_posts', 'post-new.php?post_type=' . MBK_CPT];

  if (!$farmer) { // l'administrateur garde les éventuels autres sous-menus
    foreach ($submenu[$parent] as $entry) {
      if ($entry[2] !== $parent && $entry[2] !== 'post-new.php?post_type=' . MBK_CPT) $items[] = $entry;
    }
  }
  $submenu[$parent] = $items;
}, 10001);

// L'entrée du sous-menu reste surlignée quand une catégorie est affichée
add_filter('submenu_file', function ($file) {
  global $pagenow;
  if ($pagenow === 'edit.php' && ($_GET['post_type'] ?? '') === MBK_CPT && !empty($_GET['mbk_univers'])) {
    return 'edit.php?post_type=' . MBK_CPT . '&mbk_univers=' . sanitize_key($_GET['mbk_univers']);
  }
  return $file;
});

// Filtre de la liste : seules les plantes de la catégorie choisie
add_action('pre_get_posts', function ($q) {
  global $pagenow;
  if (!is_admin() || !$q->is_main_query() || $pagenow !== 'edit.php' || $q->get('post_type') !== MBK_CPT) return;
  $u = sanitize_key($_GET['mbk_univers'] ?? '');
  if ($u === '') return;
  $mq = (array) $q->get('meta_query');
  $mq[] = ['key' => MBK_UNIVERS_META, 'value' => $u];
  $q->set('meta_query', $mq);
});

// Les liens « Tous / Publié / Brouillon » gardent la catégorie
add_filter('views_edit-' . MBK_CPT, function ($views) {
  $u = sanitize_key($_GET['mbk_univers'] ?? '');
  if ($u === '') return $views;
  foreach ($views as $k => $v) {
    $views[$k] = preg_replace('/href=([\'"])([^\'"]*)\1/', 'href=$1$2&amp;mbk_univers=' . $u . '$1', $v, 1);
  }
  return $views;
});

// Bandeau : catégorie affichée + retour à toutes les plantes
add_action('admin_notices', function () {
  $screen = function_exists('get_current_screen') ? get_current_screen() : null;
  if (!$screen || $screen->id !== 'edit-' . MBK_CPT) return;
  $u = sanitize_key($_GET['mbk_univers'] ?? '');
  if ($u === '') return;
  $choices = mbk_univers_choices();
  $label = $choices[$u] ?? $u;
  printf('<div class="notice notice-info"><p>%s Catégorie : <strong>%s</strong> — <a href="%s">Voir toutes les plantes</a></p></div>',
    mbk_univers_icon($u), esc_html($label), esc_url(admin_url('edit.php?post_type=' . MBK_CPT)));
});

// Libellés en français « plante » (au lieu de « article »)
add_filter('post_type_labels_' . MBK_CPT, function ($l) {
  $l->name = 'Plantes';
  $l->singular_name = 'Plante';
  $l->add_new = 'Ajouter une plante';
  $l->add_new_item = 'Ajouter une plante';
  $l->edit_item = 'Modifier la plante';
  $l->new_item = 'Nouvelle plante';
  $l->view_item = 'Voir la plante';
  $l->search_items = 'Rechercher une plante';
  $l->not_found = 'Aucune plante trouvée.';
  $l->not_found_in_trash = 'Aucune plante dans la corbeille.';
  $l->all_items = 'Toutes les plantes';
  return $l;
});

/* ------------------------------------------------------------------ */
/* Menu de l'administrateur : regroupé et classé par usage              */
/* (les agriculteurs gardent leur menu réduit, voir core.php)           */
/* ------------------------------------------------------------------ */
const MBK_MENU_SEPARATORS = ['mbk-sep-boutique', 'mbk-sep-contenu', 'mbk-sep-gestion'];

add_action('admin_menu', function () {
  if (mbk_is_farmer()) return;
  global $menu;
  foreach ((array) $menu as $k => $m) {
    if (in_array($m[2], ['separator1', 'separator2'], true)) unset($menu[$k]); // séparateurs vides de WordPress
  }
  $pos = 150;
  foreach (MBK_MENU_SEPARATORS as $slug) {
    $menu[$pos++] = ['', 'read', $slug, '', 'wp-menu-separator mbk-sep ' . $slug];
  }
}, 10002);

add_filter('custom_menu_order', fn ($on) => mbk_is_farmer() ? $on : true);
add_filter('menu_order', function ($order) {
  if (mbk_is_farmer()) return $order;
  global $menu;
  $kits = [];
  foreach ((array) $menu as $m) {
    if (stripos(trim(wp_strip_all_tags((string) $m[0])), 'kits') === 0) $kits[] = $m[2];
  }
  $wanted = array_merge(
    ['index.php', 'mbk-sep-boutique', 'edit.php?post_type=' . MBK_CPT, 'edit.php?post_type=produit'], $kits,
    ['mbk-sep-contenu', 'upload.php', 'edit.php?post_type=page', 'edit.php', 'edit-comments.php',
     'mbk-sep-gestion', 'users.php', 'tools.php', 'options-general.php', 'edit.php?post_type=acf-field-group', 'themes.php', 'plugins.php']
  );
  $out = array_values(array_intersect($wanted, $order));
  foreach ($order as $slug) {
    if (!in_array($slug, $out, true)) $out[] = $slug; // tout ce que nous ne connaissons pas reste en bas
  }
  return $out;
});

/* ------------------------------------------------------------------ */
/* Liste des plantes : photo, catégorie, prix et disponibilité d'un coup d'œil */
/* ------------------------------------------------------------------ */
add_filter('manage_' . MBK_CPT . '_posts_columns', function ($cols) {
  $new = ['cb' => $cols['cb'] ?? '<input type="checkbox">', 'mbk_photo' => 'Photo', 'title' => 'Plante',
          'mbk_univers' => 'Catégorie', 'mbk_prix' => 'Prix', 'mbk_dispo' => 'Disponibilité'];
  if (!mbk_is_farmer()) { $new['mbk_producteur'] = 'Producteur'; $new['mbk_ref'] = 'Réf.'; }
  foreach ($cols as $k => $label) { // colonnes ajoutées par d'autres extensions
    if (!isset($new[$k]) && !in_array($k, ['author', 'date', 'mbk_ref', 'mbk_producteur'], true)) $new[$k] = $label;
  }
  $new['date'] = $cols['date'] ?? 'Date';
  return $new;
}, 20);

add_action('manage_' . MBK_CPT . '_posts_custom_column', function ($col, $id) {
  if ($col === 'mbk_photo') {
    echo has_post_thumbnail($id)
      ? get_the_post_thumbnail($id, [64, 64], ['class' => 'mbk-thumb', 'loading' => 'lazy', 'alt' => ''])
      : '<span class="mbk-thumb mbk-thumb--vide" title="Pas de photo">📷</span>';
  }
  if ($col === 'mbk_univers') {
    $u = (string) get_post_meta($id, MBK_UNIVERS_META, true);
    $c = mbk_univers_choices();
    echo $u === '' ? '<span class="mbk-muted">—</span>' : esc_html(mbk_univers_icon($u) . ' ' . ($c[$u] ?? $u));
  }
  if ($col === 'mbk_prix') {
    $p = (float) get_post_meta($id, 'prix_unitaire', true);
    $cond = (string) get_post_meta($id, 'conditionnement', true);
    echo $p > 0 ? '<strong>' . esc_html(number_format($p, 0, ',', ' ') . ' FCFA') . '</strong>' . ($cond ? '<br><span class="mbk-muted">par ' . esc_html($cond) . '</span>' : '')
                : '<span class="mbk-muted">Sur demande</span>';
  }
  if ($col === 'mbk_dispo') {
    $d = get_post_meta($id, 'disponible', true);
    $on = !($d === '0' || $d === 0 || $d === false);
    echo $on ? '<span class="mbk-badge mbk-badge--ok">Disponible</span>' : '<span class="mbk-badge mbk-badge--off">Indisponible</span>';
  }
}, 10, 2);

// Filtres rapides du tableau de bord : plantes indisponibles, plantes sans photo
add_action('pre_get_posts', function ($q) {
  global $pagenow;
  if (!is_admin() || !$q->is_main_query() || $pagenow !== 'edit.php' || $q->get('post_type') !== MBK_CPT) return;
  $mq = (array) $q->get('meta_query');
  switch (sanitize_key($_GET['mbk_filtre'] ?? '')) {
    case 'indisponible': $mq[] = ['key' => 'disponible', 'value' => '0']; break;
    case 'sans-photo': $mq[] = ['key' => '_thumbnail_id', 'compare' => 'NOT EXISTS']; break;
    default: return;
  }
  $q->set('meta_query', $mq);
});
add_action('admin_notices', function () {
  $screen = function_exists('get_current_screen') ? get_current_screen() : null;
  if (!$screen || $screen->id !== 'edit-' . MBK_CPT) return;
  $f = sanitize_key($_GET['mbk_filtre'] ?? '');
  $labels = ['indisponible' => 'plantes indisponibles', 'sans-photo' => 'plantes sans photo'];
  if (!isset($labels[$f])) return;
  printf('<div class="notice notice-info"><p>Affichage : <strong>%s</strong> — <a href="%s">Voir toutes les plantes</a></p></div>',
    esc_html($labels[$f]), esc_url(admin_url('edit.php?post_type=' . MBK_CPT)));
});

/* ------------------------------------------------------------------ */
/* Tableau de bord de l'administrateur : chiffres à surveiller et raccourcis */
/* ------------------------------------------------------------------ */
function mbk_stat_count(array $args): int {
  $q = new WP_Query($args + ['post_type' => MBK_CPT, 'posts_per_page' => 1, 'fields' => 'ids', 'no_found_rows' => false]);
  return (int) $q->found_posts;
}

function mbk_shop_url(): string { return untrailingslashit(apply_filters('mbk_shop_url', 'https://mbayoumkeur.shop')); }

add_action('wp_dashboard_setup', function () {
  if (mbk_is_farmer()) return;
  global $wp_meta_boxes;
  $wp_meta_boxes['dashboard'] = [];
  $list = admin_url('edit.php?post_type=' . MBK_CPT);

  wp_add_dashboard_widget('mbk_overview', '🌿 Vue d’ensemble', function () use ($list) {
    $counts = wp_count_posts(MBK_CPT);
    $draft = (int) ($counts->draft ?? 0) + (int) ($counts->pending ?? 0);
    $off = mbk_stat_count(['post_status' => 'publish', 'meta_query' => [['key' => 'disponible', 'value' => '0']]]);
    $nophoto = mbk_stat_count(['post_status' => 'publish', 'meta_query' => [['key' => '_thumbnail_id', 'compare' => 'NOT EXISTS']]]);
    $tiles = [
      [(int) ($counts->publish ?? 0), 'En ligne', 'visibles sur la boutique', add_query_arg('post_status', 'publish', $list), false],
      [$draft, 'Brouillons', 'à vérifier puis publier', add_query_arg('post_status', 'draft', $list), $draft > 0],
      [$off, 'Indisponibles', 'en ligne, mais épuisées', add_query_arg(['post_status' => 'publish', 'mbk_filtre' => 'indisponible'], $list), false],
      [$nophoto, 'Sans photo', 'en ligne, à illustrer', add_query_arg(['post_status' => 'publish', 'mbk_filtre' => 'sans-photo'], $list), $nophoto > 0],
    ];
    echo '<div class="mbk-tiles">';
    foreach ($tiles as [$n, $label, $hint, $url, $alert]) {
      printf('<a class="mbk-tile%s" href="%s"><b>%d</b><span>%s</span><small>%s</small></a>', $alert ? ' mbk-tile--alerte' : '', esc_url($url), $n, esc_html($label), esc_html($hint));
    }
    echo '</div><h3 class="mbk-h3">Par catégorie</h3><ul class="mbk-cats">';
    foreach (mbk_univers_choices() as $slug => $label) {
      printf('<li><a href="%s"><span>%s %s</span><b>%d</b></a></li>', esc_url(add_query_arg('mbk_univers', $slug, $list)), esc_html(mbk_univers_icon($slug)), esc_html($label), mbk_count_univers($slug, false));
    }
    echo '</ul>';
  }, null, null, 'normal', 'high');

  wp_add_dashboard_widget('mbk_shortcuts', '⚡ Raccourcis', function () use ($list) {
    $links = [
      ['➕ Ajouter une plante', admin_url('post-new.php?post_type=' . MBK_CPT), true],
      ['📝 Brouillons à vérifier', add_query_arg('post_status', 'draft', $list), false],
      ['🛒 Voir la boutique', mbk_shop_url() . '/boutique', false],
      ['📱 Application agriculteur', mbk_shop_url() . '/agriculteur', false],
      ['👥 Producteurs', admin_url('users.php?role=' . MBK_ROLE), false],
      ['🖼️ Optimiser les images', admin_url('tools.php?page=mbk-images'), false],
      ['🔍 Doublons de plantes', admin_url('tools.php?page=mbk-doublons'), false],
    ];
    echo '<div class="mbk-links">';
    foreach ($links as [$label, $url, $primary]) {
      $ext = strpos($url, mbk_shop_url()) === 0 ? ' target="_blank" rel="noopener"' : '';
      printf('<a class="button%s" href="%s"%s>%s</a>', $primary ? ' button-primary' : '', esc_url($url), $ext, esc_html($label));
    }
    echo '</div>';
  }, null, null, 'side', 'high');
}, 1000);

// Largeur du menu : ajustée au texte le plus long (calculée dans le navigateur, mémorisée pour éviter tout saut à l'affichage)
add_action('admin_head', function () {
  echo '<script>try{var w=parseInt(localStorage.getItem("mbkMenuW"),10);if(w>=200&&w<=380)document.documentElement.style.setProperty("--mbk-menu-w",w+"px")}catch(e){}</script>';
}, 1);
add_action('admin_footer', function () {
  echo '<script>' . <<<'JS'
(function(){
  function textW(el){var r=document.createRange();r.selectNodeContents(el);return r.getBoundingClientRect().width;}
  function fit(){
    var m=document.getElementById('adminmenu');
    if(!m||document.body.classList.contains('folded')||window.innerWidth<961)return;
    var need=0;
    m.querySelectorAll('li.menu-top > a.menu-top .wp-menu-name').forEach(function(n){need=Math.max(need,textW(n)+36+16);});
    m.querySelectorAll('li.wp-has-current-submenu .wp-submenu li:not(.wp-submenu-head) a').forEach(function(a){need=Math.max(need,textW(a)+26+14);});
    var w=Math.min(380,Math.max(200,Math.ceil(need)));
    document.documentElement.style.setProperty('--mbk-menu-w',w+'px');
    try{localStorage.setItem('mbkMenuW',w);}catch(e){}
  }
  fit();
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);
  window.addEventListener('resize',fit);
})();
JS
  . '</script>';
}, 1);

/* ------------------------------------------------------------------ */
/* Masquer WordPress                                                   */
/* ------------------------------------------------------------------ */
add_action('admin_bar_menu', function ($bar) { $bar->remove_node('wp-logo'); }, 999);
add_filter('admin_footer_text', fn () => 'Mbayoumkeur · Espace producteurs');
add_filter('update_footer', '__return_empty_string', 99);
add_filter('admin_title', fn ($admin_title, $title) => $title . ' ‹ Mbayoumkeur', 10, 2);
add_filter('login_title', fn ($login_title, $title) => $title . ' ‹ Mbayoumkeur', 10, 2);
add_filter('login_headerurl', fn () => home_url('/'));
add_filter('login_headertext', fn () => 'Mbayoumkeur');
add_filter('the_generator', '__return_empty_string');
remove_action('wp_head', 'wp_generator');

add_action('admin_init', function () {
  remove_action('welcome_panel', 'wp_welcome_panel');
  if (mbk_is_farmer()) {
    remove_action('admin_notices', 'update_nag', 3);
    remove_action('admin_notices', 'maintenance_nag', 10);
    remove_action('admin_color_scheme_picker', 'admin_color_scheme_picker');
  }
});

// Aide contextuelle (pleine de références à WordPress) : retirée juste avant l'affichage
add_action('in_admin_header', function () {
  $screen = get_current_screen();
  if ($screen) $screen->remove_help_tabs();
}, 999);

// Tableau de bord : on retire les blocs WordPress, on met un message de bienvenue
add_action('wp_dashboard_setup', function () {
  global $wp_meta_boxes;
  $wp_meta_boxes['dashboard'] = [];
  wp_add_dashboard_widget('mbk_welcome', '🌿 Bienvenue sur Mbayoumkeur', function () {
    echo '<p>Publiez vos plantes depuis le menu <strong>Plantes</strong>, à gauche. Choisissez une catégorie pour ne voir que les plantes qu\'elle contient.</p>';
    echo '<p><a class="button button-primary" href="' . esc_url(admin_url('edit.php?post_type=' . MBK_CPT)) . '">Voir les plantes</a> ';
    echo '<a class="button" href="' . esc_url(admin_url('post-new.php?post_type=' . MBK_CPT)) . '">➕ Ajouter une plante</a></p>';
  });
}, 999);

/* ------------------------------------------------------------------ */
/* Couleurs de la marque                                               */
/* ------------------------------------------------------------------ */
function mbk_brand_css(): string {
  $css = <<<'CSS'
:root{--wp-admin-theme-color:#3a7d04;--wp-admin-theme-color--rgb:58,125,4;--wp-admin-theme-color-darker-10:#2b6403;--wp-admin-theme-color-darker-10--rgb:43,100,3;--wp-admin-theme-color-darker-20:#04481a;--wp-admin-theme-color-darker-20--rgb:4,72,26}
body.wp-admin{background:#f2f9ea}
a{color:#2b6403}a:hover{color:#04481a}
#adminmenuback,#adminmenuwrap,#adminmenu{background:#04481a}
#adminmenu a{color:#ffffff}
#adminmenu div.wp-menu-image:before{color:#d6efc2}
#adminmenu li.menu-top:hover,#adminmenu li.opensub>a.menu-top,#adminmenu li>a.menu-top:focus{background:#2b6403;color:#fff}
#adminmenu li.menu-top:hover div.wp-menu-image:before,#adminmenu li.opensub>a.menu-top div.wp-menu-image:before{color:#fff}
#adminmenu li.current a.menu-top,#adminmenu li.wp-has-current-submenu a.wp-has-current-submenu,#adminmenu li.wp-has-current-submenu.opensub a.wp-has-current-submenu{background:#3a7d04;color:#fff}
#adminmenu li.wp-has-current-submenu div.wp-menu-image:before,#adminmenu li.current div.wp-menu-image:before{color:#fff}
#adminmenu .wp-submenu,#adminmenu .wp-has-current-submenu .wp-submenu,#adminmenu a.wp-has-current-submenu:focus+.wp-submenu{background:#033514}
#adminmenu .wp-submenu a{color:#f1f9e6}
#adminmenu .wp-submenu a:hover,#adminmenu .wp-submenu a:focus,#adminmenu .wp-submenu li.current a{color:#ffd24d}
#adminmenu .wp-submenu .wp-submenu-head,#adminmenu .wp-has-current-submenu .wp-submenu .wp-submenu-head{background:#3a7d04;color:#fff}
#adminmenu .mbk-count{display:inline-block;float:none;background:#3a7d04;color:#fff;border-radius:9px;padding:0 7px;font-size:11px;line-height:17px;margin-left:6px;vertical-align:middle}
#adminmenu .wp-submenu li.current .mbk-count,#adminmenu .wp-submenu a:hover .mbk-count{background:#f2a900;color:#04481a}
#collapse-button,#collapse-button:hover{color:#d6efc2}
#wpadminbar{background:#04481a}
#wpadminbar .ab-item,#wpadminbar a.ab-item,#wpadminbar #adminbarsearch:before{color:#e1f1cd}
#wpadminbar .ab-top-menu>li:hover>.ab-item,#wpadminbar .ab-top-menu>li.hover>.ab-item{background:#2b6403;color:#fff}
.wp-core-ui .button-primary{background:#3a7d04;border-color:#2b6403;color:#fff}
.wp-core-ui .button-primary:hover,.wp-core-ui .button-primary:focus{background:#2b6403;border-color:#04481a;color:#fff}
.wp-core-ui .button,.wp-core-ui .button-secondary{color:#2b6403;border-color:#3a7d04}
.wp-core-ui .button:hover{background:#f2f9ea;border-color:#2b6403;color:#04481a}
.wrap h1.wp-heading-inline:before{content:"🌿 "}
.notice-info{border-left-color:#3a7d04}
#wpfooter,#wpfooter a{color:#2b6403}
body.login{background:#f2f9ea}
.login #login h1 a{background:url({{LOGO}}) center/contain no-repeat!important;width:300px;height:92px;text-indent:-9999px;font-size:0;overflow:hidden;box-shadow:none}
#adminmenu::before{content:"";display:block;height:62px;margin:10px 10px 14px;padding:6px;box-sizing:border-box;border-radius:12px;background:#fff url({{LOGO}}) center/contain no-repeat;background-origin:content-box}
.folded #adminmenu::before{height:36px;margin:8px 2px;padding:2px;background-image:url({{ICON}})}
@media screen and (max-width:960px){.auto-fold #adminmenu::before{height:36px;margin:8px 2px;padding:2px;background-image:url({{ICON}})}}
.login form{border-radius:14px;border-color:#e1f1cd}
.login .language-switcher{display:none}
.login #nav a,.login #backtoblog a{color:#2b6403}
.login .button-primary{background:#3a7d04;border-color:#2b6403}
body.wp-admin,.wp-admin input,.wp-admin select,.wp-admin textarea,.wp-core-ui .button{font-size:15px}
body.wp-admin{color:#1c2a17;line-height:1.5}
.wp-admin p.description,.wp-admin .description,.wp-admin .form-table td .description{color:#3d4a37;font-size:14px}
.wrap h1,.wrap h1.wp-heading-inline{color:#04481a;font-size:27px;font-weight:700;line-height:1.3}
#wpcontent{padding-left:28px}
#adminmenu li.menu-top>a.menu-top{font-size:15px}
#adminmenu .wp-submenu a{font-size:14px;padding:6px 12px 6px 14px}
#adminmenu li.current a.menu-top,#adminmenu li.wp-has-current-submenu a.wp-has-current-submenu{box-shadow:inset 4px 0 0 #f2a900}
#adminmenu li.mbk-sep{height:auto;margin:16px 0 4px;padding:0}
#adminmenu li.mbk-sep .separator{height:auto;min-height:0;margin:0;padding:0 16px;background:none}
#adminmenu li.mbk-sep .separator:before{display:block;padding:8px 0 4px;border-top:1px solid rgba(225,241,205,.22);font-size:11.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#ffe08a}
#adminmenu li.mbk-sep-boutique .separator:before{content:"Boutique"}
#adminmenu li.mbk-sep-contenu .separator:before{content:"Contenu du site"}
#adminmenu li.mbk-sep-gestion .separator:before{content:"Gestion"}
.folded #adminmenu li.mbk-sep .separator:before{content:"";padding:0;font-size:0}
.postbox,.stuffbox,.wp-list-table,.card{border:1px solid #d4e6bd;border-radius:12px;box-shadow:0 1px 3px rgba(4,72,26,.07)}
.postbox{overflow:hidden}
.postbox .postbox-header{background:#f4faeb;border-bottom:1px solid #d4e6bd}
.postbox .hndle,.postbox .postbox-header h2{color:#04481a;font-size:16px;font-weight:700}
.wp-list-table{overflow:hidden;border-collapse:separate;border-spacing:0}
.wp-list-table thead th,.wp-list-table tfoot th,.wp-list-table thead td,.wp-list-table tfoot td{background:#e8f3d8;color:#04481a;font-weight:700;border-color:#b9d99a}
.wp-list-table thead th a,.wp-list-table tfoot th a{color:#04481a}
.wp-list-table td,.wp-list-table th{vertical-align:middle;border-color:#e3efd4}
.striped>tbody>:nth-child(odd){background:#fff}
.striped>tbody>:nth-child(even){background:#f7fbf1}
.widefat tbody tr:hover>td,.widefat tbody tr:hover>th{background:#eef7de}
.wp-list-table .row-title{font-size:16px;font-weight:700;color:#04481a}
.wp-list-table .row-actions{font-size:13.5px}
.wp-list-table .column-mbk_photo{width:84px}
.wp-list-table .column-mbk_prix{width:140px}
.wp-list-table .column-mbk_dispo{width:130px}
.wp-list-table .column-mbk_ref{width:80px}
.mbk-thumb{display:block;width:64px;height:64px;object-fit:cover;border-radius:10px;border:1px solid #d4e6bd;background:#fff}
.mbk-thumb--vide{display:flex;align-items:center;justify-content:center;font-size:22px;background:#f2f9ea;border-style:dashed;border-color:#9fc27c}
.mbk-muted{color:#4a5844}
.mbk-badge{display:inline-block;padding:2px 11px;border-radius:999px;font-size:13px;font-weight:700;line-height:1.5}
.mbk-badge--ok{background:#e1f1cd;color:#04481a;border:1px solid #9fc27c}
.mbk-badge--off{background:#fff1c9;color:#6b4a00;border:1px solid #f2a900}
.wp-list-table .post-state{display:inline-block;margin-left:4px;padding:0 9px;border-radius:999px;background:#fff1c9;color:#6b4a00;border:1px solid #f2a900;font-size:12px;font-weight:700}
.subsubsub a{color:#2b6403}
.subsubsub a.current{color:#04481a;font-weight:700}
.subsubsub .count,.tablenav .displaying-num{color:#3d4a37}
.wp-core-ui .button,.wp-core-ui .button-secondary{min-height:38px;line-height:34px;padding:0 16px;border-radius:999px;background:#fff;font-weight:600}
.wp-core-ui .button.button-small{min-height:30px;line-height:26px;padding:0 12px}
.wp-core-ui .button-primary,.wp-core-ui a.button-primary{background:#3a7d04!important;border-color:#2b6403!important;color:#fff!important}
.wp-core-ui .button-primary:hover,.wp-core-ui a.button-primary:hover{background:#2b6403!important;border-color:#04481a!important;color:#fff!important}
.wrap .page-title-action,.wrap .page-title-action:visited{top:0;padding:8px 18px;border:0;border-radius:999px;background:#fc7404;color:#04481a;font-size:14.5px;font-weight:700}
.wrap .page-title-action:hover,.wrap .page-title-action:focus{background:#e56a00;color:#04481a}
.wp-admin input[type=text],.wp-admin input[type=search],.wp-admin input[type=number],.wp-admin input[type=email],.wp-admin input[type=url],.wp-admin input[type=password],.wp-admin input[type=tel],.wp-admin select,.wp-admin textarea{border:1px solid #9fc27c;border-radius:8px;color:#1c2a17}
.wp-admin input[type=text],.wp-admin input[type=search],.wp-admin input[type=number],.wp-admin input[type=email],.wp-admin input[type=url],.wp-admin input[type=password],.wp-admin input[type=tel],.wp-admin select{min-height:38px}
.wp-admin input:focus,.wp-admin select:focus,.wp-admin textarea:focus,.wp-core-ui .button:focus,.wp-admin a:focus{border-color:#3a7d04;box-shadow:0 0 0 3px rgba(242,169,0,.55);outline:2px solid transparent}
#titlewrap #title{min-height:52px;padding:10px 14px;font-size:22px}
.acf-field .acf-label label{color:#04481a;font-size:15px;font-weight:700}
.acf-field p.description{color:#3d4a37}
.notice{border:1px solid #d4e6bd;border-left-width:5px;border-radius:8px;box-shadow:0 1px 2px rgba(4,72,26,.05)}
.notice-warning{border-left-color:#f2a900;background:#fff8e1}
.mbk-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
.mbk-tile{display:block;padding:14px 16px;border:1px solid #d4e6bd;border-radius:12px;background:#f2f9ea;color:#1c2a17;text-decoration:none}
.mbk-tile:hover{border-color:#3a7d04;background:#e1f1cd;color:#1c2a17}
.mbk-tile b{display:block;font-size:32px;line-height:1.1;color:#04481a}
.mbk-tile span{font-size:15px;font-weight:700}
.mbk-tile small{display:block;margin-top:2px;font-size:12.5px;color:#3d4a37}
.mbk-tile--alerte{border-color:#f2a900;background:#fff8e1}
.mbk-tile--alerte b{color:#8a5a00}
.mbk-h3{margin:18px 0 8px;font-size:15px;color:#04481a}
.mbk-cats{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px 14px}
.mbk-cats li{margin:0}
.mbk-cats a{display:flex;justify-content:space-between;gap:10px;padding:7px 10px;border-radius:8px;color:#1c2a17;text-decoration:none}
.mbk-cats a:hover{background:#eef7de}
.mbk-cats b{color:#04481a}
.mbk-links{display:grid;gap:8px}
.mbk-links .button{text-align:left;justify-content:flex-start}
#adminmenu .wp-menu-name,#adminmenu .wp-submenu a{white-space:nowrap}
@media screen and (min-width:961px){
body.wp-admin:not(.folded) #wpcontent,body.wp-admin:not(.folded) #wpfooter{margin-left:var(--mbk-menu-w,260px)}
body.wp-admin:not(.folded) #adminmenuback,body.wp-admin:not(.folded) #adminmenuwrap,body.wp-admin:not(.folded) #adminmenu{width:var(--mbk-menu-w,260px)}
body.wp-admin:not(.folded) #adminmenu .wp-not-current-submenu .wp-submenu{left:var(--mbk-menu-w,260px)}
body.wp-admin:not(.folded) #adminmenu .wp-submenu{min-width:200px}
}
CSS;
  if (mbk_is_farmer()) {
    // Profil simplifié : on ne garde que l'essentiel
    $css .= '.user-rich-editing-wrap,.user-syntax-highlighting-wrap,.user-comment-shortcuts-wrap,.user-admin-bar-front-wrap,.user-admin-color-wrap,.user-url-wrap,.user-description-wrap,.application-passwords,.user-language-wrap{display:none!important}';
  }
  $base = (defined('WPMU_PLUGIN_URL') ? WPMU_PLUGIN_URL : content_url('mu-plugins')) . '/mbayoumkeur-agriculteurs/assets/';
  return str_replace(['{{LOGO}}', '{{ICON}}'], [$base . 'logo.png', $base . 'icon.png'], $css);
}
function mbk_favicon() {
  $base = (defined('WPMU_PLUGIN_URL') ? WPMU_PLUGIN_URL : content_url('mu-plugins')) . '/mbayoumkeur-agriculteurs/assets/';
  echo '<link rel="icon" type="image/png" href="' . esc_url($base . 'icon.png') . '">';
}
add_action('admin_head', 'mbk_favicon', 99);
add_action('login_head', 'mbk_favicon', 99);
add_action('admin_head', function () { echo '<style id="mbk-brand">' . mbk_brand_css() . '</style>'; });
add_action('login_head', function () { echo '<style id="mbk-brand">' . mbk_brand_css() . '</style>'; });
