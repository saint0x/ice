use tauri::menu::{
    AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Runtime};

/// Build the native application menu.
///
/// Menu item IDs that are not handled as predefined items get forwarded to the
/// frontend via an `app://menu` event so the React shell can react to them.
pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg_info = app.package_info();
    let app_name = pkg_info.name.clone();

    let about = PredefinedMenuItem::about(
        app,
        Some(&format!("About {}", app_name)),
        Some(
            AboutMetadataBuilder::new()
                .name(Some(app_name.clone()))
                .version(Some(pkg_info.version.to_string()))
                .build(),
        ),
    )?;

    // App menu (macOS only, but harmless elsewhere).
    let app_submenu = SubmenuBuilder::new(app, &app_name)
        .item(&about)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // File menu.
    let new_project = MenuItemBuilder::new("Add Project…")
        .id("file.add_project")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let new_terminal = MenuItemBuilder::new("New Terminal")
        .id("file.new_terminal")
        .accelerator("CmdOrCtrl+Shift+T")
        .build(app)?;
    let new_browser_tab = MenuItemBuilder::new("New Browser Tab")
        .id("file.new_browser_tab")
        .accelerator("CmdOrCtrl+Alt+B")
        .build(app)?;
    let save = MenuItemBuilder::new("Save")
        .id("file.save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let close_tab = MenuItemBuilder::new("Close Tab")
        .id("file.close_tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&new_project)
        .separator()
        .item(&new_terminal)
        .item(&new_browser_tab)
        .separator()
        .item(&save)
        .item(&close_tab)
        .separator()
        .close_window()
        .build()?;

    // Edit menu.
    let undo = MenuItemBuilder::new("Undo")
        .id("edit.undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let redo = MenuItemBuilder::new("Redo")
        .id("edit.redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;
    let cut = MenuItemBuilder::new("Cut")
        .id("edit.cut")
        .accelerator("CmdOrCtrl+X")
        .build(app)?;
    let copy = MenuItemBuilder::new("Copy")
        .id("edit.copy")
        .accelerator("CmdOrCtrl+C")
        .build(app)?;
    let paste = MenuItemBuilder::new("Paste")
        .id("edit.paste")
        .accelerator("CmdOrCtrl+V")
        .build(app)?;
    let select_all = MenuItemBuilder::new("Select All")
        .id("edit.select_all")
        .accelerator("CmdOrCtrl+A")
        .build(app)?;
    let find = MenuItemBuilder::new("Find…")
        .id("edit.find")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let find_in_project = MenuItemBuilder::new("Find in Project…")
        .id("edit.find_in_project")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .separator()
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .item(&select_all)
        .separator()
        .item(&find)
        .item(&find_in_project)
        .build()?;

    // View menu.
    let toggle_sidebar = MenuItemBuilder::new("Toggle Sidebar")
        .id("view.toggle_sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let toggle_dock = MenuItemBuilder::new("Toggle Terminal Panel")
        .id("view.toggle_dock")
        .accelerator("CmdOrCtrl+J")
        .build(app)?;
    let toggle_chat = MenuItemBuilder::new("Toggle Chat Panel")
        .id("view.toggle_chat")
        .accelerator("CmdOrCtrl+L")
        .build(app)?;
    let open_files = MenuItemBuilder::new("Files")
        .id("view.files")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let open_git = MenuItemBuilder::new("Git")
        .id("view.git")
        .accelerator("CmdOrCtrl+Shift+G")
        .build(app)?;
    let open_search = MenuItemBuilder::new("Search")
        .id("view.search")
        .accelerator("CmdOrCtrl+Alt+F")
        .build(app)?;
    let split_horizontal = MenuItemBuilder::new("Split Pane Right")
        .id("view.split_horizontal")
        .accelerator("CmdOrCtrl+\\")
        .build(app)?;
    let split_vertical = MenuItemBuilder::new("Split Pane Down")
        .id("view.split_vertical")
        .accelerator("CmdOrCtrl+Shift+\\")
        .build(app)?;
    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(&toggle_sidebar)
        .item(&toggle_dock)
        .item(&toggle_chat)
        .separator()
        .item(&open_files)
        .item(&open_search)
        .item(&open_git)
        .separator()
        .item(&split_horizontal)
        .item(&split_vertical)
        .separator()
        .fullscreen()
        .build()?;

    // Window menu.
    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    // Help menu.
    let docs = MenuItemBuilder::new("Documentation")
        .id("help.docs")
        .build(app)?;
    let help_submenu = SubmenuBuilder::new(app, "Help").item(&docs).build()?;

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()
}
