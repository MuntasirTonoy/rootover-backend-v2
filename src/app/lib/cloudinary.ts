import { v2 as cloudinary } from "cloudinary";
import config from "../../config/index.js";

// Avatars and thumbnails are public uploads; teacher-application documents are
// uploaded as `authenticated` assets and only reachable through signed URLs.
cloudinary.config({
	cloud_name: config.cloudinary.cloud_name,
	api_key: config.cloudinary.api_key,
	api_secret: config.cloudinary.api_secret,
	secure: true,
});

export default cloudinary;
