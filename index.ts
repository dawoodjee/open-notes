// The app's entry point. Expo Router's own entry does all the work; the one
// import ahead of it must run before the router reads the address bar
// (see lib/auth/oauthReturn.web.ts). Import order here is execution order.
import './lib/auth/oauthReturn';
import 'expo-router/entry';
