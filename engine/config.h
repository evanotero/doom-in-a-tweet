/* Hand-written replacement for the autoconf-generated config.h.
   We build directly with emcc (see ../build.sh), so there's no configure step. */

#ifndef DOOM_TWEET_CONFIG_H
#define DOOM_TWEET_CONFIG_H

#define PACKAGE "doom-in-a-tweet"
#define PACKAGE_NAME "Doom in a Tweet"
#define PACKAGE_TARNAME "doom-in-a-tweet"
#define PACKAGE_VERSION "0.1.0"
#define PACKAGE_STRING PACKAGE_NAME " " PACKAGE_VERSION
#define PACKAGE_BUGREPORT ""
#define PACKAGE_COPYRIGHT "Copyright (C) 1993-2024"
#define PACKAGE_LICENSE "GNU General Public License, version 2"
#define PROGRAM_PREFIX "doom-in-a-tweet-"

#define HAVE_DECL_STRCASECMP 1
#define HAVE_DECL_STRNCASECMP 1
#define HAVE_DIRENT_H 1

#endif
