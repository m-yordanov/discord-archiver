# Discord Archiver

A desktop application to read the messages from Discord data packages. Browse your servers, channels, and
direct messages in a familiar Discord-style interface instead of digging through
raw JSON. The application works only with Discord's official data packages. In order to accquire a data package for your account, you must request it from the Discord app itself in Settings -> Data & Privacy -> Request my data. 

The project is built with Tauri 2, React, TypeScript and Rust.

## Opening a package

The application can open either the whole .zip of the package or individual folders. There are two ways to open a package:

- **Drag** a package folder or the full `.zip` onto the window
- **Open a folder or .zip** by picking the extracted package directory

The app accepts either the package root (the folder containing `messages/`,
`servers/`, and `account/`) or the `messages/` folder on its own.

## Scope of the project

Discord's official data package contains **only the messages you sent**. A DM history
therefore renders as one side of the conversation.

This is what the application can read currently:
- Every message sent by the user who the data belongs to with information about the server and channel name or who the DM is with
- Support for media attachments 
- Searching in conversations and filtering messages by date/attachments
- Sorting DMs alphabetically, by date or by amount