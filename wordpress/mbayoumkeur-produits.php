<?php
/**
 * Plugin Name: Mbayoumkeur – Produits
 * Description: Type de contenu « Produit » + catégories, exposés dans l'API REST pour le site Node.js (headless). Sans WooCommerce.
 * Version: 1.0.0
 *
 * Installation : copier ce fichier dans wp-content/mu-plugins/ (ou le zipper et l'envoyer via Extensions > Ajouter).
 */

if (!defined('ABSPATH')) exit;

add_action('init', function () {
    register_taxonomy('categorie_produit', ['produit'], [
        'label'        => 'Catégories de produits',
        'hierarchical' => true,
        'public'       => true,
        'show_in_rest' => true,
        'rest_base'    => 'categories-produit',
    ]);

    register_post_type('produit', [
        'label'         => 'Produits',
        'labels'        => ['singular_name' => 'Produit', 'add_new_item' => 'Ajouter un produit'],
        'public'        => true,
        'menu_icon'     => 'dashicons-carrot',
        'supports'      => ['title', 'editor', 'excerpt', 'thumbnail', 'custom-fields'],
        'taxonomies'    => ['categorie_produit'],
        'show_in_rest'  => true,
        'rest_base'     => 'produits',
        'has_archive'   => false,
    ]);

    // Champs personnalisés lisibles (et modifiables par un utilisateur autorisé) via l'API REST
    register_post_meta('produit', 'prix', [
        'type' => 'integer', 'single' => true, 'show_in_rest' => true,
        'description' => 'Prix en FCFA (0 = prix sur demande)', 'default' => 0,
        'auth_callback' => fn() => current_user_can('edit_posts'),
    ]);
    register_post_meta('produit', 'unite', [
        'type' => 'string', 'single' => true, 'show_in_rest' => true,
        'description' => 'Unité de vente (pot, plant, lot…)', 'default' => '',
        'auth_callback' => fn() => current_user_can('edit_posts'),
    ]);
    register_post_meta('produit', 'disponible', [
        'type' => 'boolean', 'single' => true, 'show_in_rest' => true,
        'description' => 'Produit en stock', 'default' => true,
        'auth_callback' => fn() => current_user_can('edit_posts'),
    ]);
});
